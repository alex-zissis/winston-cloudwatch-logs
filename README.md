# Winston CloudWatch Logs
==================

Send logs to Amazon Cloudwatch using [Winston](https://github.com/winstonjs/winston).

This package is a rewrite of the popular [Winston Cloudwatch](https://github.com/lazywithclass/winston-cloudwatch/) package.
It is indetend to be more efficient, more modern, resilient and smaller.
Winston Cloudwatch Logs uses v3 of the AWS SDK, which among other things, allows for tree shaking and smaller bundle sizes, vs the bloated V2 SDK (which Winston Cloudwatch uses).

The package is intented to be fully API compatible with Winston Cloudwatch, so migrating to use it is very simple.

### Migration from Winston CloudWatch
Changing to use this package from Winston CloudWatch is as easy is:

Before:
```javascript
import WinstonCloudWatch from 'winston-cloudwatch';
```

After:
```javascript
import WinstonCloudWatch from 'winston-cloudwatch-logs';
```

After installing you can uninstall the AWS-SDK V2 (if you have no other use for it.).

```sh
$ yarn remove aws-sdk
```

There is no need to install `@aws-sdk/client-cloudwatch-logs`, it is a depencency if Winston CloudWatch Logs. Due to it's much smaller package size we are able to not have it be a peer dependency like it was in Winston CloudWatch.


All the changes are behind the scenes. I have got rid of many dependencies that are unnecessary with modern JS (lodash, aysnc.js etc.) and changed the nested callback pattern to be promises. The result is a smaller, faster and more resilient package. I will add some benchmarks comparing speed shortly.

The rest of this README.md is ripped from Winston Cloudwatch, but read on for usage details and installation instructions etc.

 * [Features](#features)
 * [Installing](#installing)
 * [Configuring](#configuring)
 * [Usage](#usage)
 * [Options](#options)
 * [Examples](#examples)
 * [Simulation](#simulation)

### Features

 * logging to AWS CloudWatchLogs
 * [logging to multiple streams](#logging-to-multiple-streams)
 * [programmatically flush logs and exit](#programmatically-flush-logs-and-exit)
 * logging with multiple levels
 * creates group / stream if they don't exist
 * waits for an upload to suceed before trying the next
 * truncates messages that are too big
 * batches messages taking care of the AWS limit (you should use more streams if you hit this a lot)
 * support for Winston's uncaught exception handler
 * support for TypeScript
 * [see options for more](#options)

### Installing

```sh
$ yarn add winston winston-cloudwatch-logs
```

```sh
$ npm install winston winston-cloudwatch-logs
```

### Configuring

AWS configuration works using `~/.aws/credentials` as written in [AWS JavaScript SDK guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/welcome.html).

As a best practice remember to use one stream per resource, so for example if you have 4 servers you should setup 4 streams
on AWS CloudWatch Logs, this is a general best practice to avoid incurring in token clashes and to avoid limits of the service (see [usage](#usage) for more).

#### Region note

As specified [in the docs](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Setting_the_Region):

 > The AWS SDK for Node.js doesn't select the region by default.

so you should take care of that. See the [examples](#examples) below.

If either the group or the stream do not exist they will be created for you.

#### AWS UI

For displaying time in AWS CloudWatch UI you should click on the gear in the top right corner in the page with your logs and enable checkbox "Creation Time".

##### TypeScript

Type definitions included :)

### Usage

Please refer to [AWS CloudWatch Logs documentation](http://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html) for possible contraints that might affect you.
Also have a look at [AWS CloudWatch Logs limits](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html).

Common JS
```js
const winston = require('winston'),
    WinstonCloudWatch = require('winston-cloudwatch-logs');
```

In ESM
```js
import winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch-logs';
```

```js
winston.add(new WinstonCloudWatch({
  logGroupName: 'testing',
  logStreamName: 'first',
  region: 'ap-southeast-2',
}));

winston.error('1');
```

You can also specify a function for the `logGroupName` and `logStreamName` options. This is handy if you are using this module in a server, say with [express](https://github.com/bithavoc/express-winston), as it enables you to easily split streams across dates, for example. There is an example of this [here](./examples/function-config.js).

#### Logging to multiple streams

You could also log to multiple streams with / without different log levels, have a look at [this example](./examples/multiple-loggers.js).

Consider that when using this feature you will have two instances of winston-cloudwatch, each with its own `setInterval` running.

#### Programmatically flush logs and exit

Think AWS Lambda for example, you don't want to leave the process running there for ever waiting for logs to arrive.

You could have winston-cloudwatch to flush and stop the setInterval loop (thus exiting), have a look
at [this example](./examples/flush-and-exit.js).

#### Custom CloudWatchLogs instance

```js
import {CloudWatchLogs} from "@aws-sdk/client-cloudwatch-logs";

const cloudWatchLogs = new CloudWatchLogs({ region: "REGION" });

winston.add(new WinstonCloudWatch({
  cloudWatchLogs,
  logGroupName: 'testing',
  logStreamName: 'first'
}));

```

### Options

This is the list of options you could pass as argument to `winston.add`:

 * name - `string`
 * level - defaults to `info`
 * logGroupName - `string` or `function`
 * logStreamName - `string` or `function`
 * cloudWatchLogs - `CloudWatchLogs` instance, used to set custom AWS instance. aws* and proxyServer options do not get used if this is set.
 * awsAccessKeyId
 * awsSecretKey
 * awsRegion
 * awsOptions - `object`, params as per [docs](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-cloudwatch-logs/interfaces/cloudwatchlogsclientconfig.html), values in `awsOptions` are overridden by any other if specified, run [this example](./examples/simple-with-aws-options.js) to have a look
 * jsonMessage - `boolean`, format the message as JSON
 * messageFormatter - `function`, format the message the way you like. This function will receive a `log` object that has the following properties: `level`, `message`, and `meta`, which are passed by winston to the `log` function (see [CustomLogger.prototype.log as an example](https://github.com/winstonjs/winston#adding-custom-transports))
 * proxyServer - `String`, use `proxyServer` as proxy in httpOptions
 * uploadRate - `Number`, how often logs have to be sent to AWS. Be careful of not hitting [AWS CloudWatch Logs limits](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html), the default is 2000ms.
 * errorHandler - `function`, invoked with an error object, if not provided the error is sent to `console.error`
 * retentionInDays - `Number`, defaults to `0`, if set to one of the possible values `1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, and 3653` the retention policy on the log group written will be set to the value provided.

AWS keys are usually picked by the AWS SDK so you don't have to specify them, I provided the option just in case. Remember that `awsRegion` should still be set if you're using IAM roles.

### Examples

Please refer to [the provided examples](./examples) for more hints.

Note that when running the examples the process will not exit because of the `setInterval`.

### Simulation

You could simulate how winston-cloudwatch runs by using the files in 
`examples/simulate`:

 * `running-process.js` represents a winston-cloudwatch process that sits there,
 sends a couple logs then waits for a signal to send more
 * `log.sh` is a script that you could run to send logs to the above
 
At this point you could for example run `log.sh` in a tight loop, like so

```bash
$ while true; do ./examples/simulate/log.sh $PID; sleep 0.2; done
```

and see what happens in the library, this might be useful to test if you need
more streams for example, all you need to do is change `running-process.js` to
better reflect your needs.

If you want more detailed information you could do

```bash
$ WINSTON_CLOUDWATCH_DEBUG=true node examples/simulate/running-process.js
```

which will print lots of debug statements as you might've guessed.