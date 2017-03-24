
import {object_getInstanceVariable, object_setInstanceVariable, CFunc, SuperCall } from './runtime.js';

export {SuperCall};

// super when returnType is id and args are void
// id objc_msgSendSuper(struct objc_super *super, SEL op, void)
const SuperInit = SuperCall(NSStringFromSelector("init"), [], {type:"@"});

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

