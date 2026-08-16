# pipipi 容器化

轻量部署示例。构建分两阶段:构建镜像产 .next,运行镜像仅需运行时依赖。

## 构建与运行

```bash
# 构建
docker build -t pipipi .

# 运行(挂载数据目录与看板目录)
mkdir -p /data/pipipi /data/boards/my-board
docker run -d --name pipipi \
  -p 3000:3000 \
  -v /data/pipipi:/root/.pipipi \
  -v /data/boards:/boards \
  -e PIPIPI_ADMIN_USER=admin \
  -e PIPIPI_ADMIN_PASSWORD='<strong-password>' \
  -e PIPIPI_PASSWORD='<basic-auth>' \
  -e OPENCODE_API_KEY='<key>' \
  -e PIPIPI_DIRS=/boards/my-board \
  pipipi
```

## 说明

- `PIPIPI_DATA_DIR` 默认 `~/.pipipi`(容器内 `/root/.pipipi`),挂卷持久化用户/认证/全局角色模板。
- 看板目录通过 `PIPIPI_DIRS` 注入(或 Web 内注册);Agent 文件工具在该目录工作。
- 生产建议:HTTPS 反向代理 + `PIPIPI_PASSWORD` Basic Auth。
