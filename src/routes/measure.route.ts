import express, { type Router } from 'express';
import type { Config } from '../config.js';
import { checkSign } from '../util.js';
import type { IStorage } from '../storage/base.storage.js';
import { join } from 'path';
import { logger } from '../logger.js';
import got from 'got'

export default function MeasureRouteFactory(config: Config, storage: IStorage): Router {
  const router = express.Router();
  const storageType = process.env.CLUSTER_STORAGE || 'file';
  router.get('/:size(\\d+)', async (req, res) => {
    // 签名验证
    const isSignValid = checkSign(req.baseUrl + req.path, config.clusterSecret, req.query as NodeJS.Dict<string>);
    if (!isSignValid) return res.sendStatus(403);

    // 解析文件大小
    const size = parseInt(req.params.size, 10);
    if (isNaN(size) || size > 200) return res.sendStatus(400);

    // 如果 storageType 是 'alist'，则使用 302 重定向到文件
    if (storageType === 'alist') {
      try {
        const filename = `${size}MB`;
        const filePath = join('measure', filename);

        // 检查文件是否存在，如果不存在则生成
        if (!await storage.exists(filePath)) {
          const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
          await storage.writeFile(filePath, content, {
            path: filePath,
            hash: '',
            size: content.length,
            mtime: Date.now(),
          });
          logger.info(`已生成测速文件: ${filename}`);
        }

        // 获取直链地址
        const downloadUrl = storage.getAbsolutePath(filePath);

        // 发起302请求
        const resp = await got.get(downloadUrl, {
          followRedirect: false,
          timeout: { request: 30e3 },
          throwHttpErrors: false
        });

        // 处理重定向
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return res.redirect(resp.headers.location);
        }

        // 处理最终响应
        return res
          .status(resp.statusCode)
          .set(resp.headers)
          .send(resp.body);

      } catch (error) {
        logger.error('获取重定向地址失败:', error);
        res.status(500).send('Internal Server Error');
      }
    } else {
      // 如果不是alist，直接返回文件内容
      const buffer = Buffer.alloc(1024 * 1024, '0066ccff', 'hex');
      res.set('content-length', (size * 1024 * 1024).toString());
      for (let i = 0; i < size; i++) {
        res.write(buffer);
      }
      res.end();
    }
  });

  return router;
}
