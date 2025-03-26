module.exports = (log: Record<string, any>) => {
    // 在日志消息前加上 [Node-OBA-Fix] 前缀
    if (log.msg) {
      log.msg = `[Node-OBA-Fix] ${log.msg}`;
    }
    return log;
  };
  