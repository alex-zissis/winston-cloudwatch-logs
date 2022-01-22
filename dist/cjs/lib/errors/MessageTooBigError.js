"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageTooBigError = void 0;
class MessageTooBigError extends Error {
    constructor(message) {
        super(message);
    }
}
exports.MessageTooBigError = MessageTooBigError;
