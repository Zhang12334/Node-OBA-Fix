import { config } from './config.js';
import { logger } from './logger.js';

class Notify {
    public async send(message: string): Promise<void> {
        logger.debug("准备发送通知")

        // 拼合message
        message = `[${config.clusterName || "Cluster"}] ${message}`;

        try {
            if (!config.notifyEnabled) return;

            if (config.notifyType === 'webhook') {
                await this.handleWebhook(message);
            } else if (config.notifyType === 'onebot') {
                await this.handleOneBot(message);
            } else {
                logger.error(`未知的通知类型: ${config.notifyType}`);
            }
        } catch (error: any) {
            logger.error(`发送通知时发生错误: ${error.message}`);
        }
    }

    private async handleWebhook(message: string): Promise<void> {
        logger.debug("准备发送Webhook通知")
        if (!config.notifyWebhookUrl) {
            logger.error('Webhook通知发送失败: 未配置NOTIFY_WEBHOOK_URL');
            return;
        }

        try {
            // 读取自定义Json Key
            let key = config.notifyWebhookJsonKey || "content";

            const response = await fetch(config.notifyWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, // Json格式
                body: JSON.stringify({ [key]: message })
            });            

            if (!response.ok) {
                throw new Error(`HTTP 响应码 ${response.status}`);
            }
            // 发送成功
            logger.info(`Webhook通知发送成功`);            
        } catch (error: any) {
            logger.error(`Webhook通知发送失败: ${error.message}`);
        }
    }

    private async handleOneBot(message: string): Promise<void> {
        logger.debug("准备发送Onebot通知")
        const requiredConfig = [
            { key: config.notifyOnebotHttpApi, name: 'NOTIFY_ONEBOT_HTTP_API' },
            { key: config.notifyOnebotType, name: 'NOTIFY_ONEBOT_TYPE' },
            { key: config.notifyOnebotTarget, name: 'NOTIFY_ONEBOT_TARGET' }
        ];

        for (const { key, name } of requiredConfig) {
            if (!key) {
                logger.error(`OneBot通知发送失败: 配置项缺失 ${name}`);
                return;
            }
        }

        const target = Number(config.notifyOnebotTarget);
        if (isNaN(target)) {
            logger.error('OneBot通知发送失败: 目标ID必须为数字');
            return;
        }

        try {
            const apiPath = config.notifyOnebotType === 'private' 
                ? 'send_private_msg' 
                : 'send_group_msg';
            
            const requestBody = {
                [config.notifyOnebotType === 'private' ? 'user_id' : 'group_id']: target,
                message: message
            };

            const headers = {
                'Content-Type': 'application/json',
                ...(config.notifyOnebotSecret && { 
                    Authorization: `Bearer ${config.notifyOnebotSecret}` 
                })
            };

            const apiUrl = new URL(apiPath, config.notifyOnebotHttpApi).toString();
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });

            // 检查HTTP状态
            const responseText = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${responseText}`);
            }

            // 发送成功
            logger.info(`OneBot通知发送成功`);
        } catch (error: any) {
            logger.error(`OneBot通知发送失败: ${error.message}`);
        }
    }
}

const notify = new Notify();
export { notify };
