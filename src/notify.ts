import { config } from './config.js';
import { logger } from './logger.js';
import { scSend } from 'serverchan-sdk'; 

class Notify {
    // 递归替换占位符的辅助方法
    private replacePlaceholders(obj: any, variables: Record<string, string>): any {
        if (typeof obj === 'string') {
            return obj.replace(/\${(.*?)}/g, (_, key) => variables[key] || '');
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.replacePlaceholders(item, variables));
        } else if (obj !== null && typeof obj === 'object') {
            const cloned: { [key: string]: any } = {};
            for (const [k, v] of Object.entries(obj)) {
                cloned[k] = this.replacePlaceholders(v, variables);
            }
            return cloned;
        }
        return obj;
    }

    public async send(message: string): Promise<void> {
        logger.debug("准备发送通知")

        // 拼合message
        const spliced_message = `[${config.clusterName || "Cluster"}] ${message}`;

        try {
            if (!config.notifyEnabled) return;

            if (config.notifyType === 'webhook') {
                await this.handleWebhook(message, spliced_message);
            } else if (config.notifyType === 'onebot') {
                await this.handleOneBot(spliced_message);
            } else if (config.notifyType === 'workwechat') {
                await this.handleWorkWechat(message);
            } else if (config.notifyType === 'dingtalk') {
                await this.handleDingTalk(message);
            } else if (config.notifyType === 'serverchan') {
                await this.handleServerChan(message);
            } else {
                logger.error(`未知的通知类型: ${config.notifyType}`);
            }
        } catch (error: any) {
            logger.error(`发送通知时发生错误: ${error.message}`);
        }
    }

    // 企业微信
    private async handleWorkWechat(message: string): Promise<void> {
        logger.debug("准备发送企业微信 Webhook 通知")
        if (!config.notifyWorkWechatWebhookUrl) {
            logger.error('企业微信通知发送失败: 未配置NOTIFY_WORKWECHAT_WEBHOOK_URL');
            return;
        }

        try {
            // 提醒消息
            if (config.notifyWorkWechatMentionList.length > 0) {
                logger.debug("准备发送企业微信提醒消息")
                const textResponse = await fetch(config.notifyWorkWechatWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        msgtype: 'text',
                        text: {                       
                            mentioned_mobile_list: config.notifyWorkWechatMentionList, // 提醒列表
                        },
                    }),
                });

                if (!textResponse.ok) {
                    throw new Error(`提醒消息发送失败, HTTP 响应码 ${textResponse.status}`);
                }
            }

            // 发送 Markdown 消息
            const markdownResponse = await fetch(config.notifyWorkWechatWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: 'markdown',
                    markdown: {
                        // 动态构建标题颜色
                        content: `### <font color="${config.notifyWorkWechatMessageTitleColor || "warning"}">[${config.clusterName || "Cluster"}]</font>\n` +
                                `${message}\n`,
                    },
                }),
            });

            if (!markdownResponse.ok) {
                throw new Error(`Markdown 消息发送失败, HTTP 响应码 ${markdownResponse.status}`);
            }

            // 发送成功
            logger.info(`企业微信通知发送成功`);
        } catch (error: any) {
            logger.error(`企业微信 Webhook 通知发送失败: ${error.message}`);
        }
    }

    private async handleDingTalk(message: string): Promise<void> {
        logger.debug("准备发送钉钉自定义机器人 Webhook 通知");
    
        if (!config.notifyDingTalkWebhookUrl) {
            logger.error('钉钉自定义机器人 Webhook 发送失败: 未配置NOTIFY_DINGTALK_WEBHOOK_URL');
            return;
        }
    
        try {

            let payload = {
                msgtype: 'markdown',
                markdown: {
                    title: `[${config.clusterName || "Cluster"}]`,
                    text: `# [${config.clusterName || "Cluster"}] \n ${message}`
                }
            };
    
            // 发送请求到钉钉Webhook
            const response = await fetch(config.notifyDingTalkWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
    
            if (!response.ok) {
                throw new Error(`HTTP 响应码 ${response.status}`);
            }
    
            // 发送成功
            logger.info(`钉钉自定义机器人 Webhook 通知发送成功`);
        } catch (error: any) {
            logger.error(`钉钉自定义机器人 Webhook 通知发送失败: ${error.message}`);
        }
    }
    
    // ServerChan
    private async handleServerChan(message: string): Promise<void> {
        logger.debug("准备发送 Server 酱通知");

        // 检查是否配置了 Server酱 SendKey
        if (!config.notifyServerChanSendKey) {
            logger.error('Server 酱通知发送失败: 未配置 NOTIFY_SERVERCHAN_SENDKEY');
            return;
        }

        // 构造消息标题
        const title = `[${config.clusterName || "Cluster"}]`;

        try {
            // 调用 Server酱 SDK 发送消息
            const response = await scSend(
                config.notifyServerChanSendKey, // SendKey
                title, // 消息标题
                message // 消息内容
            );

            // 检查响应状态码
            if (response.code !== 0) {
                throw new Error(`请求状态码 ${response.code}`);
            }

            // 发送成功
            logger.info(`Server 酱通知发送成功`);
        } catch (error: any) {
            logger.error(`Server 酱通知发送失败: ${error.message}`);
        }
    }

    // Webhook 通知处理
    private async handleWebhook(rawMessage: string, processedMessage: string): Promise<void> {
        logger.debug("准备发送 Webhook 通知")
        if (!config.notifyWebhookUrl) {
            logger.error('Webhook 通知发送失败: 未配置 NOTIFY_WEBHOOK_URL');
            return;
        }

        try {
            const prefix = config.clusterName || 'Cluster';
            const now = new Date();
            // 格式化日期为 YYYY-MM-DD
            const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            // 格式化时间为 HH:MM:SS
            const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            // 格式化日期时间为 YYYY-MM-DD HH:MM:SS
            const datetime = `${date} ${time}`;
            // 变量列表
            const variables = {
                raw_message: rawMessage,
                message: processedMessage,
                prefix: prefix,
                timestamp: String(Date.now()), // 当前时间戳
                datetime: datetime, // 格式化的日期时间
                date: date, // 格式化的日期
                time: time, // 格式化的时间
            };
            
            

            // 构造请求体
            let requestBody: object;
            if (config.notifyWebhookCustomJson) {
                // 解析自定义 JSON 模板
                const customTemplate = JSON.parse(config.notifyWebhookCustomJson);
                requestBody = this.replacePlaceholders(customTemplate, variables);
            } else {
                // 不使用自定义模板
                const key = config.notifyWebhookJsonKey || "content";
                requestBody = { [key]: processedMessage };
            }

            const response = await fetch(config.notifyWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP 响应码 ${response.status}`);
            }
            logger.info('Webhook 通知发送成功');
        } catch (error: any) {
            logger.error(`Webhook 通知发送失败: ${error.message}`);
        }
    }

    // Onebot
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
