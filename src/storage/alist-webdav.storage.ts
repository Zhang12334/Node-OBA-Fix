import type {Request, Response} from 'express'
import got from 'got'
import Keyv from 'keyv'
import {KeyvFile} from 'keyv-file'
import ms from 'ms'
import {join} from 'path'
import {z} from 'zod'
import {fromZodError} from 'zod-validation-error'
import {WebdavStorage} from './webdav.storage.js'
import {config} from '../config.js'
import {type FileStat, type ResponseDataDetailed} from 'webdav'
import {logger} from '../logger.js'

const storageConfigSchema = WebdavStorage.configSchema.extend({
  cacheTtl: z.union([z.string().optional(), z.number().int()]).default('1h'),
})

export class AlistWebdavStorage extends WebdavStorage {
  public readonly configSchema = storageConfigSchema

  protected readonly redirectUrlCache: Keyv<string>
  protected readonly storageConfig: z.infer<typeof storageConfigSchema>

  constructor(storageConfig: unknown) {
    super(storageConfig)
    try {
      this.storageConfig = this.configSchema.parse(storageConfig)
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error('alist存储选项无效', {cause: fromZodError(e)})
      } else {
        throw new Error('alist存储选项无效', {cause: e})
      }
    }
    let ttl: number
    if (typeof this.storageConfig.cacheTtl === 'string') {
      ttl = ms(this.storageConfig.cacheTtl)
    } else {
      ttl = this.storageConfig.cacheTtl
    }
    this.redirectUrlCache = new Keyv<string>({
      namespace: 'redirectUrl',
      ttl,
      store: new KeyvFile({
        filename: join(process.cwd(), 'cache', 'redirectUrl.json'),
        writeDelay: ms('1m'),
      }),
    })
  }

  public async express(hashPath: string, req: Request, res: Response): Promise<{bytes: number; hits: number}> {
    if (this.emptyFiles.has(hashPath)) {
      res.end()
      return {bytes: 0, hits: 1}
    }
    const path = join(this.basePath, hashPath)    
    // 如果 this.files 中没有文件信息，尝试从存储中获取文件大小
    let size = this.files.get(hashPath)?.size ?? 0;
    if (size === 0) {
      try {
        const fileStat = await this.client.stat(path);
        // 处理 ResponseDataDetailed<FileStat> 的情况
        size = (fileStat as ResponseDataDetailed<FileStat>).data?.size ?? (fileStat as FileStat).size;
      } catch (e) {
        logger.error(e, '无法获取文件大小');
      }
    }
    const totalSize = this.getSize(size, req.headers.range)
    if (!config.disableWebdav302Cache){
      // 如果没有禁用302缓存，查询缓存，如果存在则直接返回
      const cachedUrl = await this.redirectUrlCache.get(hashPath)
      if (cachedUrl) {
        res.status(302).location(cachedUrl).send()
        return {bytes: totalSize, hits: 1}
      }
    }
    const url = this.client.getFileDownloadLink(path)
    const resp = await got.get(url, {
      followRedirect: false,
      responseType: 'buffer',
      headers: {
        range: req.headers.range,
      },
      https: {
        rejectUnauthorized: false,
      },
      timeout: {
        request: 30e3,
      },
    })
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      res.status(resp.statusCode).send(resp.body)
      return {bytes: resp.body.length, hits: 1}
    }
    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
      res.status(resp.statusCode).location(resp.headers.location).send()
      await this.redirectUrlCache.set(hashPath, resp.headers.location)
      return {bytes: totalSize, hits: 1}
    }
    res.status(resp.statusCode).send(resp.body)
    return {bytes: 0, hits: 0}
  }
}
