# oss-browser

一个简单的 oss 文件管理器。

特点是，oss 密钥信息不保存在服务端，而是保存在 url 上。

每次发起请求，都会携带 oss 信息用于在后端为 oss 鉴权。

因此，这允许你在不同的浏览器 tab，去连接不同的 oss。

并且也方便直接把 url 分享给别人。

### how to dev

```
# start backend
python server.py
# start frontend
yarn dev
```

### how to run

```
./run.sh
```
