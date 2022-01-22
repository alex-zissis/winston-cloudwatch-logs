import { LogEvent } from '../cloudwatch.js';
declare class MessageTooBigError extends Error {
    logEvent: LogEvent;
    constructor(message: string);
}
export { MessageTooBigError };
