import {types} from 'util';
const {isTypedArray} = types;

const getTag = (value: any) => {
    if (value == null) {
        return value === undefined ? '[object Undefined]' : '[object Null]';
    }
    return Object.prototype.toString.call(value);
};

const isObjectLike = (value: any) => {
    return typeof value === 'object' && value !== null;
};

const isPlainObject = (value: any) => {
    if (!isObjectLike(value) || getTag(value) != '[object Object]') {
        return false;
    }
    if (Object.getPrototypeOf(value) === null) {
        return true;
    }
    let proto = value;
    while (Object.getPrototypeOf(proto) !== null) {
        proto = Object.getPrototypeOf(proto);
    }
    return Object.getPrototypeOf(value) === proto;
};

export const isError = (value: any) => {
    if (!isObjectLike(value)) {
        return false;
    }
    const tag = getTag(value);
    return (
        tag == '[object Error]' ||
        tag == '[object DOMException]' ||
        (typeof value.message === 'string' && typeof value.name === 'string' && !isPlainObject(value))
    );
};

const isLength = (value: any) => {
    return typeof value === 'number' && value > -1 && value % 1 == 0 && value <= 9007199254740991;
};

const isArrayLike = (value) => {
    return value != null && typeof value !== 'function' && isLength(value.length);
};

const isArguments = (value: any) => {
    return isObjectLike(value) && getTag(value) == '[object Arguments]';
};

const isPrototype = (value: any) => {
    const Ctor = value && value.constructor;
    const proto = (typeof Ctor === 'function' && Ctor.prototype) || Object.prototype;

    return value === proto;
};

export const isEmpty = (value: any) => {
    if (value == null) {
        return true;
    }
    if (
        isArrayLike(value) &&
        (Array.isArray(value) ||
            typeof value === 'string' ||
            typeof value.splice === 'function' ||
            Buffer.isBuffer(value) ||
            isTypedArray(value) ||
            isArguments(value))
    ) {
        return !value.length;
    }
    const tag = getTag(value);
    if (tag == '[object Map]' || tag == '[object Set]') {
        return !value.size;
    }
    if (isPrototype(value)) {
        return !Object.keys(value).length;
    }
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            return false;
        }
    }
    return true;
};


const _ = {isEmpty, isError};
export default _;