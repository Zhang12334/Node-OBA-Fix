# 这是什么？

OpenBMCLAPI 是一个高效、灵活的 Minecraft 资源分发系统，旨在为国内 Minecraft 社区提供稳定、快速的资源下载服务

它通过分布式节点的方式，将资源文件分发到各地的服务器上，从而提升玩家的下载体验

本项目是 OpenBMCLAPI 官方 Node.JS 客户端的一个改进版本，增加了诸如 Onebot/Webhook 通知、额外的文件同步配置项、控制台日志优化等额外功能

本项目为 302 至其他下载服务器 (如通过 Alist 解析或 MinIO 302 下载请求至其他 OSS 服务器) 的服务方式进行了优化, 使其更加稳定可靠, 同时大幅降低了部署此类节点的成本

因此, 使用本项目的节点端, 通过简单的配置即可在低性能、低带宽服务器上搭建数个与高配本地节点无异的 OpenBMCLAPI 节点

# 安装

## 所需环境

- Node.js 20 及以上(使用安装包进行安装则无需自带Node.js环境, 但无法使用自动更新功能)
- 一个支持 Node.js 的系统
- 一个支持 Node.js 的架构

## 安装包

### 下载

从 [Github Release](https://github.com/bangbang93/openbmclapi/releases) 中选择对应你的系统/架构的最新版本

若没有对应你的系统/架构的安装包, 请查看[从源码安装](#从源码安装)

请跳转到[设置参数](#设置参数)部分 

## 从源码安装

### 设置环境

1. 去 <https://nodejs.org/zh-cn/> 下载对应你系统/架构版本的LTS版本的Node.js并安装

2. Clone 并安装依赖、进行编译

```bash
## 获取源码
git clone https://github.com/Zhang12334/node-oba-fix
## 切换路径
cd node-oba-fix
## 安装依赖
npm i
## 编译程序
npm run build
## 运行程序
node dist/index.js
```

3. 如果你看到了 `CLUSTER_ID is not set` 的报错, 说明一切正常, 该设置参数了

## 设置参数

由于配置项过多, 请在此处查看全部可选参数: [配置项说明](env.md)

在程序根目录创建一个文件, 名为 `.env`

写入如下内容

```env
CLUSTER_ID=你的节点ID
CLUSTER_SECRET=你的节点密钥
CLUSTER_PORT=你的开放端口
# 更多变量请看上方的配置项说明文档
```

## Docker使用方法

按照[设置参数](#设置参数)部分创建并配置好 `.env` 文件
不要设置**自动更新**，请确保`ENABLE_AUTO_UPDATE=false`

### 使用 Docker Cli

```bash
docker run -d --name node-oba-fix \
  -p ${CLUSTER_PORT}:${CLUSTER_PORT} \
  -v /openbmclapi/cache:/opt/openbmclapi/cache \
  -v /openbmclapi/env:/opt/openbmclapi/.env \
  -v /openbmclapi/data:/opt/openbmclapi/data \
  -e TZ=Asia/Shanghai \
  --restart unless-stopped \
  zhang134/node-oba-fix:latest
```

### 使用 Docker Compose

在项目根目录创建 `docker-compose.yml` 文件，写入以下内容：

```yaml
version: '3.8'

services:
  openbmclapi:
    image: zhang134/node-oba-fix:latest
    container_name: node-oba-fix
    network_mode: "bridge"
    environment:
      - CLUSTER_PORT=${CLUSTER_PORT}
      - TZ=Asia/Shanghai
    ports:
      - "${CLUSTER_PORT}:${CLUSTER_PORT}"
    volumes:
      - /openbmclapi/cache:/opt/openbmclapi/cache
      - /openbmclapi/.env:/opt/openbmclapi/.env
      - /openbmclapi/data:/opt/openbmclapi/data
    restart: unless-stopped
```

然后运行以下命令启动容器：

```bash
docker-compose up -d
```

## S3使用方法

S3配置: 
```env
CLUSTER_STORAGE=minio
CLUSTER_STORAGE_OPTIONS={"url": "http://ak:sk@someminio/bucket/prefix"}
```

对于内外网分开访问的情况: 
```env
CLUSTER_STORAGE=minio
CLUSTER_STORAGE_OPTIONS={"url": "http://ak:sk@someminio/bucket/prefix", "internalUrl": "http://ak:sk@192.168.1.1/bucket/prefix"}
```
url是用户访问时重定向到的，internal是节点端访问api时使用的

也支持自定义host: 
```env
CLUSTER_STORAGE=minio
CLUSTER_STORAGE_OPTIONS={"url": "http://ak:sk@someminio/bucket/prefix", "customHost":"http://someminio/prefix"}
```

## Alist使用方法
在.env中加上
```env
CLUSTER_STORAGE=alist
CLUSTER_STORAGE_OPTIONS={"url":"http://127.0.0.1:5244/dav","basePath":"oba","username":"admin","password":"admin" }
#                                      ↑AList地址(别忘了加/dav)         ↑文件路径          ↑账号(有webdav权限)  ↑密码
```
按照需要修改

## 温馨提示

如果您正在从 Go 端迁移至 Node 端，请确保 Alist 中的目录结构符合以下要求：

### 示例 1

如果您的目录结构如下：

```file_tree
oba/
├── download/
│   ├── 00/
│   ├── 01/
│   ├── 03/
│   └── xx/（其他文件夹）
├── measure/
│   ├── 1
│   ├── 2
│   └── 3
```

则 `basePath` 应设置为 `"oba/download"`

### 示例 2

如果您的目录结构如下：

```file_tree
download/
├── 00/
├── 01/
├── 03/
└── xx/（其他文件夹）
measure/
├── 1
├── 2
└── 3
```

则 `basePath` 应设置为 `"download"`

### 说明
- `basePath` 是 Alist 中资源文件的根目录路径，需根据实际目录结构填写
- 配置完成后，运行程序，它将自动拉取文件，并在文件同步完成后上线

# 同步数据

openbmclapi 会自行同步需要的文件, 但是初次同步可能会速度过慢, 如果您的节点是个全量节点, 可以通过以下命令使用rsync快速同步
以下三台rsync服务器是相同的, 你可以选择任意一台进行同步
- `rsync -rzvP openbmclapi@home.933.moe::openbmclapi cache`
- `rsync -avP openbmclapi@storage.yserver.ink::bmcl cache`
- `rsync -azvrhP openbmclapi@openbmclapi.home.mxd.moe::data cache`

# 致谢

- [**bangbang93**](https://github.com/bangbang93) 本项目 Fork 自 bangbang93 的 [OpenBMCLAPI](https://github.com/bangbang93/openbmclapi/) 项目
- [**ApliNi**](https://github.com/ApliNi) Dashboard API 改自 ApliNi 的 [aplPanel](https://github.com/ApliNi/aplPanel) 项目
- [**Uright-Xuqing233**](https://github.com/Uright-Xuqing233) 帮助提供 Docker 构建文件 & 修改 MinIO 相关代码
- [**YlovexLN**](https://github.com/YlovexLN) 帮助提供 Docker 相关配置 & 修改文档