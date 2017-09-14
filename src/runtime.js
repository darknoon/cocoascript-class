// You can store this to call your function. this must be bound to the current instance.
export function SuperCall(selector, argTypes, returnType) {
  const func = CFunc("objc_msgSendSuper", [{type: '^' + objc_super_typeEncoding}, {type: ":"}, ...argTypes], returnType);
  return function() {
    const struct = make_objc_super(this, this.superclass());
    const structPtr = MOPointer.alloc().initWithValue_(struct);
    const params = ['structPtr', 'selector'].concat(
      [].slice.apply(arguments).map((val, i) => `arguments[${i}]`)
    )
    return eval(`func(${params.join(', ')})`)
  };
}

// Recursively create a MOStruct
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

// Due to particularities of the JS bridge, we can't call into MOBridgeSupport objects directly
// But, we can ask key value coding to do the dirty work for us ;)
function setKeys(o, d) {
  const funcDict = NSMutableDictionary.dictionary()
  funcDict.o = o
  Object.keys(d).map( k => funcDict.setValue_forKeyPath(d[k], "o." + k) )
}

// Use any C function, not just ones with BridgeSupport
export function CFunc(name, args, retVal) {
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
  // OK, so this is probably the nastiest hack in this file.
  // We go modify MOBridgeSupportController behind its back and use kvc to add our own definition
  // There isn't another API for this though. So the only other way would be to make a real bridgesupport file.
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
export const object_getInstanceVariable = CFunc("object_getInstanceVariable", [{type: "@"}, {type:'*'}, {type: "^@"}], {type: "^{objc_ivar=}"});
// Again, ivar is of object type
export const object_setInstanceVariable = CFunc("object_setInstanceVariable", [{type: "@"}, {type:'*'}, {type: "@"}], {type: "^{objc_ivar=}"});

// We need Mocha to understand what an objc_super is so we can use it as a function argument
addStructToBridgeSupport('objc_super', {type:objc_super_typeEncoding});

