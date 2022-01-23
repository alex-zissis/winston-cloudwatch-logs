const winston = require('winston'),
    WinstonCloudWatch = require('../dist/cjs/index')

const me = winston.add(new WinstonCloudWatch({
  name: 'using-kthxbye',
  logGroupName: 'testing',
  logStreamName: 'another',
  awsRegion: 'us-east-1'
}))

winston.error('1')

// flushes the logs and clears setInterval
let transport = me.transports.find(t => t.name === 'using-kthxbye')
transport.kthxbye(() => console.log('bye'))
