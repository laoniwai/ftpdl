require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const net = require('net');
const { Client: FtpClient } = require('basic-ftp');
const { Client: SshClient } = require('ssh2');

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(morgan('dev'));

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// FTP代理服务
const createFtpProxy = (clientSocket, targetHost, targetPort = 21) => {
  console.log(`创建FTP代理连接到 ${targetHost}:${targetPort}`);
  
  const serverSocket = net.createConnection({
    host: targetHost,
    port: targetPort
  }, () => {
    console.log(`已连接到FTP服务器 ${targetHost}:${targetPort}`);
    
    // 双向数据传输
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });
  
  serverSocket.on('error', (err) => {
    console.error(`FTP服务器连接错误: ${err.message}`);
    clientSocket.end();
  });
  
  clientSocket.on('error', (err) => {
    console.error(`客户端连接错误: ${err.message}`);
    serverSocket.end();
  });
  
  serverSocket.on('end', () => {
    console.log(`FTP服务器连接关闭: ${targetHost}:${targetPort}`);
    clientSocket.end();
  });
  
  clientSocket.on('end', () => {
    console.log('客户端连接关闭');
    serverSocket.end();
  });
};

// SFTP代理服务
const createSftpProxy = (clientSocket, targetHost, targetPort = 22) => {
  console.log(`创建SFTP代理连接到 ${targetHost}:${targetPort}`);
  
  const serverSocket = net.createConnection({
    host: targetHost,
    port: targetPort
  }, () => {
    console.log(`已连接到SFTP服务器 ${targetHost}:${targetPort}`);
    
    // 双向数据传输
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });
  
  serverSocket.on('error', (err) => {
    console.error(`SFTP服务器连接错误: ${err.message}`);
    clientSocket.end();
  });
  
  clientSocket.on('error', (err) => {
    console.error(`客户端连接错误: ${err.message}`);
    serverSocket.end();
  });
  
  serverSocket.on('end', () => {
    console.log(`SFTP服务器连接关闭: ${targetHost}:${targetPort}`);
    clientSocket.end();
  });
  
  clientSocket.on('end', () => {
    console.log('客户端连接关闭');
    serverSocket.end();
  });
};

// 启动FTP代理服务器
const ftpProxyServer = net.createServer((socket) => {
  socket.once('data', (data) => {
    // 从第一个数据包中提取主机信息
    const firstLine = data.toString().split('\n')[0];
    const match = firstLine.match(/USER\s+([^@\s]+)@([^:\s]+)(?::(\d+))?/i);
    
    if (match) {
      const username = match[1];
      const targetHost = match[2];
      const targetPort = match[3] ? parseInt(match[3]) : 21;
      
      console.log(`FTP代理请求: ${username}@${targetHost}:${targetPort}`);
      
      // 修改数据包，移除@hostname部分
      const modifiedData = data.toString().replace(`${username}@${targetHost}`, username);
      
      // 创建到目标服务器的连接
      const serverSocket = net.createConnection({
        host: targetHost,
        port: targetPort
      }, () => {
        console.log(`已连接到FTP服务器 ${targetHost}:${targetPort}`);
        
        // 发送修改后的第一个数据包
        serverSocket.write(modifiedData);
        
        // 设置双向数据传输
        socket.pipe(serverSocket);
        serverSocket.pipe(socket);
      });
      
      serverSocket.on('error', (err) => {
        console.error(`FTP服务器连接错误: ${err.message}`);
        socket.end();
      });
    } else {
      console.error('无法从FTP请求中提取主机信息');
      socket.end();
    }
  });
  
  socket.on('error', (err) => {
    console.error(`FTP客户端连接错误: ${err.message}`);
  });
});

// 启动SFTP代理服务器
const sftpProxyServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let hostInfo = null;
  
  socket.on('data', (data) => {
    if (hostInfo) return; // 已经提取了主机信息
    
    buffer = Buffer.concat([buffer, data]);
    
    // 尝试从SSH握手数据中提取主机信息
    // 这里简化处理，假设用户名格式为 username@hostname:port
    const dataStr = buffer.toString();
    const match = dataStr.match(/([^@\s]+)@([^:\s]+)(?::(\d+))?/);
    
    if (match) {
      const username = match[1];
      const targetHost = match[2];
      const targetPort = match[3] ? parseInt(match[3]) : 22;
      
      hostInfo = { username, targetHost, targetPort };
      console.log(`SFTP代理请求: ${username}@${targetHost}:${targetPort}`);
      
      // 创建到目标服务器的连接
      createSftpProxy(socket, targetHost, targetPort);
    }
  });
  
  socket.on('error', (err) => {
    console.error(`SFTP客户端连接错误: ${err.message}`);
  });
});

// 启动HTTP服务器
app.listen(PORT, () => {
  console.log(`HTTP服务器运行在 http://localhost:${PORT}`);
});

// 启动FTP代理服务器
const FTP_PROXY_PORT = process.env.FTP_PROXY_PORT || 2121;
ftpProxyServer.listen(FTP_PROXY_PORT, () => {
  console.log(`FTP代理服务器运行在端口 ${FTP_PROXY_PORT}`);
  console.log(`使用方式: 在FTP客户端中使用 username@targethost:targetport 作为用户名`);
});

// 启动SFTP代理服务器
const SFTP_PROXY_PORT = process.env.SFTP_PROXY_PORT || 2222;
sftpProxyServer.listen(SFTP_PROXY_PORT, () => {
  console.log(`SFTP代理服务器运行在端口 ${SFTP_PROXY_PORT}`);
  console.log(`使用方式: 在SFTP客户端中使用 username@targethost:targetport 作为用户名`);
});

module.exports = { app, ftpProxyServer, sftpProxyServer };