const express = require('express');
const morgan = require('morgan');
const { Client: FtpClient } = require('basic-ftp');
const { Client: SshClient } = require('ssh2');

const PORT = process.env.PORT || 8080;
const FTP_USER = process.env.FTP_USER;
const FTP_PASSWORD = process.env.FTP_PASSWORD;
const SSH_USER = process.env.SSH_USER;
const SSH_PASSWORD = process.env.SSH_PASSWORD;

const app = express();

app.use(morgan('dev'));
app.use(express.raw({ type: '*/*' }));

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// FTP 代理 (简化示例)
app.post('/ftp/:hostport', async (req, res) => {
  const hostport = req.params.hostport;
  const [hostname, portStr] = hostport.split(':');
  const port = parseInt(portStr) || 21;
  const data = req.body.toString('utf8');

  try {
    const ftpClient = new FtpClient();
    ftpClient.ftp.verbose = true;

    await ftpClient.connect({ host: hostname, port: port });

    if (!FTP_USER || !FTP_PASSWORD) {
        return res.status(500).send("FTP_USER and FTP_PASSWORD must be set");
    }

    await ftpClient.login({ user: FTP_USER, password: FTP_PASSWORD });


    // 示例：发送 LIST 命令
    await ftpClient.send(data); // 发送客户端请求的数据作为FTP 命令

    const list = await ftpClient.list();  // 假设客户端请求返回文件列表

    res.status(200).send(list.toString());
    ftpClient.close();

  } catch (err) {
    console.error(`FTP 代理错误: ${err.message}`);
    res.status(500).send(`FTP 代理错误: ${err.message}`);
  }
});

// SFTP 代理 (简化示例)
app.post('/sftp/:hostport', (req, res) => {
  const hostport = req.params.hostport;
  const [hostname, portStr] = hostport.split(':');
  const port = parseInt(portStr) || 22;
  const data = req.body.toString('utf8');

    if (!SSH_USER || !SSH_PASSWORD) {
        return res.status(500).send("SSH_USER and SSH_PASSWORD must be set");
    }

  const conn = new SshClient();

  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP 客户端创建失败', err);
        return res.status(500).send('SFTP 客户端创建失败');
      }

      // 示例：执行 ls -l 命令
      sftp.readdir('/', (err, list) => { // 假设客户端请求返回文件列表
        if (err) {
          console.error('SFTP 命令执行失败', err);
          return res.status(500).send('SFTP 命令执行失败');
        }

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
    username: SSH_USER,
    password: SSH_PASSWORD,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP服务器运行在 http://localhost:${PORT}`);
});
