import {LogEvent} from '../cloudwatch.js';

class MessageTooBigError extends Error {
    logEvent: LogEvent;
    constructor(message: string) {
        super(message);
    }
}

export {MessageTooBigError};