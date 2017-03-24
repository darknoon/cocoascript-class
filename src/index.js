
// Recursively create a struct
function makeStruct(def) {
  if (typeof def !== 'object' || Object.keys(def).length == 0) {
    return def;
  }
  const name = Object.keys(def)[0];
  const values = def[name];

  const structure = MOStruct.structureWithName_memberNames_runtime(name, Object.keys(values), Mocha.sharedRuntime());

  Object.keys(values).map( member => {
    structure[member] = makeStruct(values[member]);
  });

  return structure;
}

const objc_super_typeEncoding = '{objc_super="receiver"@"super_class"#}';
function make_objc_super(self, cls) {
  return makeStruct({
    objc_super:{
        receiver:self,
        super_class: cls,
    },
  });
}

// Copy-paste this into 💎Sketch.app and run it 🔥
// Scroll to bottom for usage

// Due to particularities of the JS bridge, we can't call into MOBridgeSupport objects directly
// But, we can ask key value coding to do the dirty work for us ;)
function setKeys(o, d) {
  const funcDict = NSMutableDictionary.dictionary()
  funcDict.o = o
  Object.keys(d).map( k => funcDict.setValue_forKeyPath(d[k], "o." + k) )
}

// Use any C function, not just ones with BridgeSupport
function CFunc(name, args, retVal) {
  function makeArgument(a) {
    if (!a) return null;
    const arg = MOBridgeSupportArgument.alloc().init();
    setKeys(arg, {
     type64: a.type,
    });
    return arg;
  }
  const func = MOBridgeSupportFunction.alloc().init();
  setKeys(func, {
    name: name,
    arguments: args.map(makeArgument),
    returnValue: makeArgument(retVal),
  })
  return func;
}

/*
@encode(char*) = "*"
@encode(id) = "@"
@encode(Class) = "#"
@encode(void*) = "^v"
@encode(CGRect) = "{CGRect={CGPoint=dd}{CGSize=dd}}"
@encode(SEL) = ":"
*/

function addStructToBridgeSupport(key, structDef) {
  const def = MOBridgeSupportStruct.alloc().init();
  setKeys(def, {
     name: key,
     type: structDef.type,
  });
  log("adding def: " + def);

  const symbols = MOBridgeSupportController.sharedController().valueForKey('symbols');
  if (!symbols) throw Error("Something has changed within bridge support so we can't add our definitions");
  symbols[NSString.stringWithString(key)] = def;
};

// This assumes the ivar is an object type. Return value is pretty useless.
const object_getInstanceVariable = CFunc("object_getInstanceVariable", [{type: "@"}, {type:'*'}, {type: "^@"}], {type: "^{objc_ivar=}"});
// Again, ivar is of object type
const object_setInstanceVariable = CFunc("object_setInstanceVariable", [{type: "@"}, {type:'*'}, {type: "@"}], {type: "^{objc_ivar=}"});

// super when returnType is id and args are void
// id objc_msgSendSuper(struct objc_super *super, SEL op, void)
export const SuperInit = SuperCall(NSStringFromSelector("init"), [], {type:"@"});
// SuperInit;

// You can store this to call your function. this must be bound to the current instance.
function SuperCall(selector, argTypes, returnType) {
  const func = CFunc("objc_msgSendSuper", [{type: '^' + objc_super_typeEncoding}, {type: ":"}, ...argTypes], returnType);
  return function(...args) {
    const struct = make_objc_super(this, this.superclass());
    const structPtr = MOPointer.alloc().initWithValue_(struct);
    return func(structPtr, selector, ...args);
  };
}

// Returns a real ObjC class. No need to use new.
export default function ObjCClass(defn) {
  const superclass = defn.superclass || NSObject;
  const className = (defn.className || defn.classname || "ObjCClass") + NSUUID.UUID().UUIDString()
  const reserved = new Set(['className', 'classname','superclass']);
  var cls = MOClassDescription.allocateDescriptionForClassWithName_superclass_(className, superclass)
  // Add each handler to the class description
  const ivars = [];
  for(var key in defn) {
    const v = defn[key];
    if (typeof v == 'function' && key !== 'init') {
      var selector = NSSelectorFromString(key)
      cls.addInstanceMethodWithSelector_function_(selector, v);
    } else if (!reserved.has(key)) {
       ivars.push(key);
       cls.addInstanceVariableWithName_typeEncoding(key, "@");
    }
  }

    cls.addInstanceMethodWithSelector_function_(NSSelectorFromString('init'), function() {
      //const superr = make_objc_super(this, this.superclass());
      //const superPtr = MOPointer.alloc().initWithValue_(superr);
      const self = SuperInit.call(this);
      ivars.map( name => {
        Object.defineProperty(self, name, {
          get() { return getIvar(self, name) },
          set(v) { object_setInstanceVariable(self, name, v) },
        });
        self[name] = defn[name];
      });
      // If there is a passsed-in init funciton, call it now.
      if (typeof defn.init == 'function') defn.init.call(this);
      return self;
    });

  return cls.registerClass();
};

function getIvar(obj, name) {
  const retPtr = MOPointer.new();
  object_getInstanceVariable(obj, name, retPtr);
  return retPtr.value().retain().autorelease();
}


/**************************************
************** Usage ******************
***************************************/

// We need Mocha to understand what an objc_super is so we can use it as a function argument
addStructToBridgeSupport('objc_super', {type:objc_super_typeEncoding});

