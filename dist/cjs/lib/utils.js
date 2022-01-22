"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringify = exports.handleErrorObject = exports.debug = void 0;
const chalk_1 = __importDefault(require("chalk"));
const fast_safe_stringify_1 = __importDefault(require("fast-safe-stringify"));
const handleErrorObject = (key, value) => {
    if (value instanceof Error) {
        return Object.getOwnPropertyNames(value).reduce((error, key) => {
            error[key] = value[key];
            return error;
        }, {});
    }
    return value;
};
exports.handleErrorObject = handleErrorObject;
const stringify = (o) => (0, fast_safe_stringify_1.default)(o, handleErrorObject, '  ');
exports.stringify = stringify;
const debug = (...args) => {
    if (!process.env.WINSTON_CLOUDWATCH_DEBUG)
        return;
    var lastParam = args.pop();
    var color = chalk_1.default.red;
    if (lastParam !== true) {
        args.push(lastParam);
        color = chalk_1.default.green;
    }
    args[0] = color(args[0]);
    args.unshift(chalk_1.default.blue('DEBUG:'));
    console.log.apply(console, args);
};
exports.debug = debug;
