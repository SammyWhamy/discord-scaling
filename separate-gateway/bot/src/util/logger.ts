import chalk from "chalk";

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
}

let logLevel = LogLevel.INFO;
if (process.env.LOG_LEVEL) {
    const unparsed = process.env.LOG_LEVEL;
    if (isNaN(parseInt(unparsed))) {
        const level = LogLevel[unparsed.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined)
            logLevel = level;
    } else {
        const level = parseInt(unparsed);
        if (level >= 0 && level <= 4)
            logLevel = level;
    }

}

export interface LogOptions {
    task: string;
    step: string;
    message: string;
    level: LogLevel;
}

const colors = {
    [LogLevel.DEBUG]: chalk.blue,
    [LogLevel.INFO]: chalk.whiteBright,
    [LogLevel.WARN]: chalk.yellowBright,
    [LogLevel.ERROR]: chalk.redBright,
    [LogLevel.FATAL]: chalk.redBright,
}

function generateTimestamp() {
    return chalk.gray(`[${new Date(Date.now()).toLocaleTimeString([], {hour12: false})}]`);
}

function generateTaskPrefix(level: LogLevel, task: string) {
    return colors[level](`[${task.toUpperCase()}]`.padEnd(5));
}

function generateStepPrefix(level: LogLevel, step: string) {
    return colors[level](`[${step}]`.padEnd(8));
}

export function log(options: LogOptions) {
    const text = colors[options.level](`${generateTaskPrefix(options.level, options.task)} => ${generateStepPrefix(options.level, options.step)} => ${options.message}`)

    if (options.level >= logLevel)
        console.log(`${generateTimestamp()} ${text}`);
}
