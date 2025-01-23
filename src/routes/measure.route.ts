import express, { type Router } from 'express';
import type { Config } from '../config.js';
import { checkSign } from '../util.js';
import type { IStorage } from '../storage/base.storage.js';
import { join } from 'path';
import fetch from 'node-fetch';
import { logger } from '../logger.js';

const storageType = process.env.CLUSTER_STORAGE || 'file';
const davStorageUrl = process.env.CLUSTER_STORAGE_OPTIONS ? JSON.parse(process.env.CLUSTER_STORAGE_OPTIONS) : {};
const davBaseUrl = `${davStorageUrl.url}/${davStorageUrl.basePath}`;

async function getRedirectUrl(filename: string, size: number, storage: IStorage): Promise<string> {
  if (storageType === 'alist') {
    const redirectUrl = `${davBaseUrl}/${filename}`;

    try {
      const response = await fetch(redirectUrl, {
        method: 'HEAD',
        headers: {
          Authorization: `Basic ${Buffer.from(`${davStorageUrl.username}:${davStorageUrl.password}`).toString('base64')}`,
        },
      });

      if (response.status === 200) {
        return redirectUrl;
      }

      if (response.status === 302) {
        const newRedirectUrl = response.headers.get('location');
        if (newRedirectUrl) {
          return newRedirectUrl;
        }
      }
    } catch (error) {
      logger.error(error, '获取DAV存储重定向地址失败');
      throw error;
    }

    // 如果文件不存在，生成文件逻辑
    const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
    try {
      const response = await fetch(redirectUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${Buffer.from(`${davStorageUrl.username}:${davStorageUrl.password}`).toString('base64')}`,
          'Content-Type': 'application/octet-stream',
        },
        body: content,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload file: ${response.statusText}`);
      }

      logger.info(`已生成测速文件: ${size}MB`);
      return redirectUrl;
    } catch (error) {
      logger.error(error, '上传文件失败');
      throw error;
    }
  } else {
    // 原有方法逻辑
    const basePath = process.env.CLUSTER_MEASURE_302PATH || '';
    const redirectUrl = `${basePath}/measure/${filename}`;

    const fileExists = await storage.exists(join('measure', filename));

    if (!fileExists) {
      const content = Buffer.alloc(size * 1024 * 1024, '0066ccff', 'hex');
      await storage.writeFile(join('measure', filename), content, {
        path: join('measure', filename),
        hash: '',
        size: size * 1024 * 1024,
        mtime: Date.now(),
      });
      logger.info(`已生成测速文件: ${size}MB`);
    }

    return redirectUrl;
  }
}

export default function MeasureRouteFactory(config: Config, storage: IStorage): Router {
  const router = express.Router();

  router.get('/:size(\d+)', async (req, res) => {
    const isSignValid = checkSign(req.baseUrl + req.path, config.clusterSecret, req.query as NodeJS.Dict<string>);
    if (!isSignValid) return res.sendStatus(403);

    const size = parseInt(req.params.size, 10);
    if (isNaN(size) || size > 200) return res.sendStatus(400);
    const filename = `${size}MB`;

    try {
      const newUrl = await getRedirectUrl(filename, size, storage);
      if (storageType === 'alist') {
        res.redirect(newUrl);
      } else {
        const buffer = Buffer.alloc(1024 * 1024, '0066ccff', 'hex');
        res.set('content-length', (size * 1024 * 1024).toString());
        for (let i = 0; i < size; i++) {
          res.write(buffer);
        }
        res.end();
      }
    } catch (error) {
      res.status(500).send('获取重定向地址失败');
    }
  });

  return router;
}