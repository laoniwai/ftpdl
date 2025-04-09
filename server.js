const express = require('express');
const morgan = require('morgan');
const net = require('net');
const { Client: FtpClient } = require('basic-ftp');
const { Client: SshClient } = require('ssh2');
const stream = require('stream');

// 配置
const PORT = process.env.PORT || 8080;

// 创建 Express 应用
const app = express();

// 中间件
app.use(morgan('dev'));
app.use(express.raw({ type: '*/*' })); // 处理所有类型的内容，包括二进制数据

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// FTP 代理
app.post('/ftp/:hostport', async (req, res) => {
  const hostport = req.params.hostport;
  const [hostname, portStr] = hostport.split(':');
  const port = parseInt(portStr) || 21;
  const data = req.body;

  console.log(`FTP 代理请求: ${hostname}:${port}`);

  try {
    const ftpClient = new FtpClient();
    ftpClient.ftp.verbose = true; // 开启调试模式，查看FTP命令

    await ftpClient.connect({ host: hostname, port: port });
    await ftpClient.login({/*需要用户名密码就写这里*/});

    // 关键：将请求体数据作为 FTP 命令发送
    const dataString = data.toString('utf8');  // 将 Buffer 转为字符串，假设是文本命令
    await ftpClient.send(dataString); // 发送命令

    // 从服务器读取响应 (示例，可能需要根据实际 FTP 命令调整)
    const list = await ftpClient.list();

    // 将响应发送回客户端
    res.status(200).send(list.toString());
    ftpClient.close();

  } catch (err) {
    console.error(`FTP 代理错误: ${err.message}`);
    res.status(500).send(`FTP 代理错误: ${err.message}`);
  }
});


// SFTP 代理 (类似 FTP，但需要使用 ssh2 库)
app.post('/sftp/:hostport', (req, res) => {
  const hostport = req.params.hostport;
  const [hostname, portStr] = hostport.split(':');
  const port = parseInt(portStr) || 22;
  const data = req.body;

  console.log(`SFTP 代理请求: ${hostname}:${port}`);

  const conn = new SshClient();

  conn.on('ready', () => {
    console.log('SFTP 连接成功');
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP 客户端创建失败', err);
        return res.status(500).send('SFTP 客户端创建失败');
      }

      const command = data.toString();

      // execute 方式运行命令
      sftp.readdir('/', (err, list) => {
        if (err) {
          console.error('SFTP readdir命令执行失败', err);
          return res.status(500).send('SFTP 命令执行失败');
        }
        console.log('目录内容：', list);
        res.status(200).send(list);

        sftp.end();
        conn.end();

      });

    });
  }).on('error', (err) => {
    console.error('SSH 连接错误', err);
    return res.status(500).send('SSH 连接错误');
  }).connect({
    host: hostname,
    port: port,
    username: 'test',
    password: 'password'
  });


});

// 启动 HTTP 服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP服务器运行在 http://localhost:${PORT}`);
});
