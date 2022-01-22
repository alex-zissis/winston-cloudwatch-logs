class MessageTooBigError extends Error {
    logEvent;
    constructor(message) {
        super(message);
    }
}
export { MessageTooBigError };
