import safeStringify from 'fast-safe-stringify';

const AnsiReset = '\u001b[0m';

const noChalk = {
    _colorize: (str: string, ansiColor: string) => `${ansiColor}${str}${AnsiReset}`,

    blue: (str: string) => noChalk._colorize(str, '\u001b[34m'),
    green: (str: string) => noChalk._colorize(str, '\u001b[32m'),
    red: (str: string) => noChalk._colorize(str, '\u001b[31m'),

}

const handleErrorObject = (key: string, value: any) => {
    if (value instanceof Error) {
        return Object.getOwnPropertyNames(value).reduce((error, key) => {
            error[key] = value[key];
            return error;
        }, {});
    }
    return value;
};

const stringify = (o: object) => {
    try {
        return JSON.stringify(o, handleErrorObject, '  ');
    } catch(e) {
        return safeStringify(o, handleErrorObject, '  ');
    }
}

const debug = (...args: any[]) => {
    if (!process.env.WINSTON_CLOUDWATCH_DEBUG) return;
    var lastParam = args.pop();
    var color = noChalk.red;
    if (lastParam !== true) {
        args.push(lastParam);
        color = noChalk.green;
    }

    args[0] = color(args[0]);
    args.unshift(noChalk.blue('DEBUG:'));
    console.log.apply(console, args);
};

export {debug, handleErrorObject, stringify};
