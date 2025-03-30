import { config } from './config.js';  // 导入配置
import { logger } from './logger.js';  // 导入日志

class Webhook {
    private url = config.webhookUrl;
    private clusterName = `[${config.clusterName}]` || "[Cluster]";

    public async send(message: string): Promise<void> {
        if (!this.url) {
            logger.warn('未填写 Webhook URL, 无法发送');
            return;
        }

        const trimmedMessage = message?.trim();
        if (!trimmedMessage) {
            logger.error('Webhook 消息为空');
            return;
        }
        logger.debug(`成功获取到 Webhook 消息主体: ${trimmedMessage}`)

        try {
            const sendMessage = `${this.clusterName} ${trimmedMessage}`;
            logger.debug(`成功构建 Webhook 消息: ${sendMessage}`)
            const response = await fetch(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: sendMessage })
            });

            if (!response.ok) {
                throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`);
            }

            logger.info(`Webhook 消息已发送`);
            logger.debug(`消息内容: ${sendMessage}`);
        } catch (error) {
            logger.error('Webhook 发送失败: ', error);
        }
    }
}

// 创建 Webhook 实例
const webhook = new Webhook();

// 导出 webhook 实例，方便在其他地方使用
export { webhook };
