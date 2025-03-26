import {pino} from 'pino'

const transport = pino.transport({
  target: 'pino-pretty', // 使用官方提供的格式化工具
  options: {
    colorize: true,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '[Node-OBA-Fix] {msg}'
  }
});

export const logger = pino(transport);
