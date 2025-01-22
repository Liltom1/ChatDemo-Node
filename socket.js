import http from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken';
import express from 'express'
import fs from 'node:fs'
import fs2 from 'node:fs/promises'
import { json } from 'node:stream/consumers';
import { type } from 'node:os';
import { log } from 'node:console';
import path from 'node:path'
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const secretKey = 'xmzs' //加盐

const app = express()
app.use(express.json());
app.use('*', (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    next()
})
// 设置静态目录
app.use('/images', express.static(path.join(__dirname, 'images')));

const server = http.createServer(app)
//登录接口
app.post('/api/login', (req, res) => {
    fs2.readFile('./userinfo.txt').then(data => {
        let users = []
        // console.log(req.body,'req.body')
        users = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
        if (users.length) {
            //遍历用户信息
            const userInfo = users.find(item => item.name === req.body.name && item.password === req.body.password)
            if (userInfo) {
                res.json({
                    message: '登录成功',
                    code: 200,
                    token: jwt.sign({ id: userInfo.id }, secretKey, { expiresIn: 60 * 60 * 24 }), //生成token expiresIn: 60 * 60 * 24 有效期24小时
                    userInfo: {
                        name: userInfo.name,
                        id: userInfo.id,
                        rooms: userInfo.rooms
                    },  //返回用户信息
                })
            } else {
                res.json({
                    message: '登录失败,用户名或密码错误!',
                    code: 400
                })
            }
        } else {
            res.json({
                message: '登录失败',
                code: 400
            })
        }
    }).catch(err => {
        console.log('读取文件失败', err)
        res.json({
            message: '登录失败',
            code: 400
        })
    })
})

//查询聊天记录
app.get('/api/messageList', (req, res) => {
    fs2.readFile('./message.txt').then(data => {
        const messageList = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
        res.json({
            message: '返回用户信息成功',
            code: 200,
            messageList: messageList,  //返回用户信息成功
        })
    }).catch(err => {
        console.log('读取文件失败', err)
        res.json({
            message: '返回用户信息失败',
            code: 400
        })
    })

})


const io = new Server(server, {
    cors: true //允许跨域
})


io.on('connection', (socket) => {
    const headers = socket.request.headers;
    jwt.verify(headers.authorization, secretKey, (err, decoded) => {
        if (err) {
            socket.emit('reject', false)
            return
        }
    })

    //查询当前用户房间
    socket.on('search', ({ userId }) => {
        fs2.readFile('./userinfo.txt').then(data => {
            let users = []
            users = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
            const userInfo = users.find(item => item.id === userId)
            console.log(userInfo.rooms);

            socket.emit('receiveRoom', userInfo.rooms)
        }).catch(err => {
            console.log('读取文件失败', err)
        })
    })

    //进入房间
    socket.on('join', ({ roomId, userName }) => {
        socket.join(roomId)
        // console.log(userName, '加入了', roomId);
    })

    //接收文字消息
    socket.on('sendMessage', ({ roomId, message, from, time, type }) => {
        const messageInfo = JSON.stringify({
            roomId,
            message,
            from,
            time,
            type: type,
        })
        //将消息写入文件
        fs.appendFile(`./message.txt`, `${messageInfo}\n`, (err) => {
            if (err) {
                console.log('写入文件失败', err)
            }
        })
        //给房间内的人发送消息
        socket.broadcast.to(roomId).emit('receiveMessage', {
            roomId,
            message,
            from,
            time,
            type: type,
        })
    })

    //接收图片消息
    socket.on('sendImgMessage', ({ roomId, message, from, time, file, fileName, type }) => {

        //避免文件名重复
        const filePath = `./images/${fileName}`;

        const imageBuffer = Buffer.from(file.buffer, 'base64');

        //将图片写入文件
        fs.writeFile(filePath, imageBuffer, (err) => {
            if (err) {
                console.log('写入文件失败', err)
                //给房间内的人发送消息
                socket.broadcast.to(roomId).emit('fileErrMessage', {
                    message: "写入文件失败!",
                    from,
                })
                return
            }
        })
        const messageInfo = JSON.stringify({
            roomId,
            message: `/images/${fileName}`,
            from,
            time,
            type: type,
        })
        //将消息写入文件
        fs.appendFile(`./message.txt`, `${messageInfo}\n`, (err) => {
            if (err) {
                console.log('写入文件失败', err)
            }
        })

        //给房间内的人发送消息
        socket.broadcast.to(roomId).emit('receiveMessage', {
            roomId,
            message: `/images/${fileName}`,
            from,
            time,
            type: type,
            fileName: `/images/${fileName}`,
            file: imageBuffer,
        })
        console.log('发消息')
    })

    //查询某个房间的聊天记录
    socket.on('searchCurrentRoomMessage', ({ roomId }) => {
        fs2.readFile('./message.txt').then(data => {
            const messageList = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
            console.log(messageList, 'messageList');
            
            const currentRoomMessageList = messageList.filter(item => item.roomId === roomId)
            socket.emit('receiveCurrentRoomMessage', currentRoomMessageList)
        }).catch(err => {
            console.log('读取文件失败', err)
        })
    })

    //新建房间
    socket.on('newRoom', async ({ user, roomName }) => {
        let roomId = null
        await fs2.readFile('./room.txt').then(data => {
            const room = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
            console.log(room.length, 'room');
            roomId = room.length + 1
        }).catch(err => {
            console.log('读取文件失败', err)
        })
        const roomInfo = {
            id: roomId.toString(),
            name: roomName,
            people: [user.id],
        }
        console.log(roomInfo, 'roomInfo');

        //将消息写入文件
        fs.appendFile(`./room.txt`, `${JSON.stringify(roomInfo)}\n`, (err) => {
            if (err) {
                console.log('写入文件失败', err)
            }
        })

        //将房间信息写入用户信息
        fs2.readFile('./userinfo.txt').then(data => {
            let users = []
            users = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
            const userInfo = users.find(item => item.id === user.id)
            userInfo.rooms.push({ id: roomId.toString(), name: roomName })
            fs.writeFile(`./userinfo.txt`, users.map(item => JSON.stringify(item)).join('\n'), (err) => {
                if (err) {
                    console.log('写入文件失败', err)
                }
            })
        }).catch(err => {
            console.log('读取文件失败', err)
        })
        socket.emit('newRoomSuccess')
    })

    //加入房间
    socket.on('addRoom', async ({ user, roomName }) => {
        let roomInfo1 = null
        await fs2.readFile('./room.txt').then(data => {
            // console.log(roomInfo, 'roomInfo');
            const room = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
            console.log(room, 'room');
            console.log(roomName, 'roomName');
            let roomInfo = room.find(item => item.name === roomName)
            roomInfo.people.push(user.id)
            console.log(roomInfo, 'roomInfo');
    
            //将消息写入文件
            fs.writeFile(`./room.txt`, room.map(item => JSON.stringify(item)).join('\n'), (err) => {
                if (err) {
                    console.log('写入文件失败', err)
                }
            })

            //将房间信息写入用户信息
            fs2.readFile('./userinfo.txt').then(data => {
                let users = []
                users = data.toString().split('\n').filter(item => item).map(item => JSON.parse(item))
                const userInfo = users.find(item => item.id === user.id)
                console.log({ id: roomInfo.id.toString(), name: roomName },'userInfo');
                
                userInfo.rooms.push({ id: roomInfo.id.toString(), name: roomName })
                fs.writeFile(`./userinfo.txt`, users.map(item => JSON.stringify(item)).join('\n'), (err) => {
                    if (err) {
                        console.log('写入文件失败', err)
                    }
                })
            }).catch(err => {
                console.log('读取文件失败', err)
            })
            socket.emit('addRoomSuccess')
        }).catch(err => {
            console.log('读取文件失败', err)
        })


    })

    //断开链接内置事件
    socket.on('disconnect', () => {
        console.log('断开链接');
    })

})

server.listen(3000, () => {
    console.log('listening on *:3000');
});