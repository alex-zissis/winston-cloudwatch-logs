import chalk from 'chalk';
import safeStringify from 'fast-safe-stringify';

const handleErrorObject = (key: string, value: any) => {
    if (value instanceof Error) {
        return Object.getOwnPropertyNames(value).reduce((error, key) => {
            error[key] = value[key];
            return error;
        }, {});
    }
    return value;
};

const stringify = (o: object) => safeStringify(o, handleErrorObject, '  ');

const debug = (...args: any[]) => {
    if (!process.env.WINSTON_CLOUDWATCH_DEBUG) return;
    var lastParam = args.pop();
    var color = chalk.red;
    if (lastParam !== true) {
        args.push(lastParam);
        color = chalk.green;
    }

    args[0] = color(args[0]);
    args.unshift(chalk.blue('DEBUG:'));
    console.log.apply(console, args);
};

export {debug, handleErrorObject, stringify};
