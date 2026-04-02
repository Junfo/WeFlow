import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { wcdbService } from './wcdbService'
import { ConfigService } from './config'
import { chatService, Message } from './chatService'
import { ipcMain } from 'electron'
import { createHash } from 'crypto'

export interface BizAccount {
  username: string
  name: string
  avatar: string
  type: number
  last_time: number
  formatted_last_time: string
}

export interface BizMessage {
  local_id: number
  create_time: number
  title: string
  des: string
  url: string
  cover: string
  content_list: any[]
  raw?: any // 调试用
}

export interface BizPayRecord {
  local_id: number
  create_time: number
  title: string
  description: string
  merchant_name: string
  merchant_icon: string
  timestamp: number
  formatted_time: string
}

export class BizService {
  private configService: ConfigService

  constructor() {
    this.configService = new ConfigService()
  }

  private extractXmlValue(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i')
    const match = regex.exec(xml)
    if (match) {
      return match[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim()
    }
    return ''
  }

  private parseBizContentList(xmlStr: string): any[] {
    if (!xmlStr) return []
    const contentList: any[] = []
    try {
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi
      let match: RegExpExecArray | null
      while ((match = itemRegex.exec(xmlStr)) !== null) {
        const itemXml = match[1]
        const itemStruct = {
          title: this.extractXmlValue(itemXml, 'title'),
          url: this.extractXmlValue(itemXml, 'url'),
          cover: this.extractXmlValue(itemXml, 'cover') || this.extractXmlValue(itemXml, 'thumburl'),
          summary: this.extractXmlValue(itemXml, 'summary') || this.extractXmlValue(itemXml, 'digest')
        }
        if (itemStruct.title) contentList.push(itemStruct)
      }
    } catch (e) {}
    return contentList
  }

  private parsePayXml(xmlStr: string): any {
    if (!xmlStr) return null
    try {
      const title = this.extractXmlValue(xmlStr, 'title')
      const description = this.extractXmlValue(xmlStr, 'des')
      const merchantName = this.extractXmlValue(xmlStr, 'display_name') || '微信支付'
      const merchantIcon = this.extractXmlValue(xmlStr, 'icon_url')
      const pubTime = parseInt(this.extractXmlValue(xmlStr, 'pub_time') || '0')
      if (!title && !description) return null
      return { title, description, merchant_name: merchantName, merchant_icon: merchantIcon, timestamp: pubTime }
    } catch (e) { return null }
  }

  /**
   * 核心：获取公众号消息，支持从 biz_message*.db 自动定位
   */
  private async getBizRawMessages(username: string, account: string, limit: number, offset: number): Promise<Message[]> {
    console.log(`[BizService] getBizRawMessages: ${username}, offset=${offset}, limit=${limit}`)
    
    // 1. 首先尝试直接用 chatService.getMessages (如果 Native 层支持路由)
    const chatRes = await chatService.getMessages(username, offset, limit)
    if (chatRes.success && chatRes.messages && chatRes.messages.length > 0) {
      console.log(`[BizService] chatService found ${chatRes.messages.length} messages for ${username}`)
      return chatRes.messages
    }

    // 2. 如果 chatService 没找到，手动扫描 biz_message*.db (类似 Python 逻辑)
    console.log(`[BizService] chatService empty, manual scanning biz_message*.db...`)
    const root = this.configService.get('dbPath')
    const accountWxid = account || this.configService.get('myWxid')
    if (!root || !accountWxid) return []

    const dbDir = join(root, accountWxid, 'db_storage', 'message')
    if (!existsSync(dbDir)) return []

    const md5Id = createHash('md5').update(username).digest('hex').toLowerCase()
    const tableName = `Msg_${md5Id}`
    const bizDbFiles = readdirSync(dbDir).filter(f => f.startsWith('biz_message') && f.endsWith('.db'))

    for (const file of bizDbFiles) {
      const dbPath = join(dbDir, file)
      // 检查表是否存在
      const checkRes = await wcdbService.execQuery('message', dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='${tableName}'`)
      if (checkRes.success && checkRes.rows && checkRes.rows.length > 0) {
        console.log(`[BizService] Found table ${tableName} in ${file}`)
        // 分页查询原始行
        const sql = `SELECT * FROM ${tableName} ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`
        const queryRes = await wcdbService.execQuery('message', dbPath, sql)
        if (queryRes.success && queryRes.rows) {
          // *** 复用 chatService 的解析逻辑 ***
          return chatService.mapRowsToMessagesForApi(queryRes.rows)
        }
      }
    }

    return []
  }

  async listAccounts(account?: string): Promise<BizAccount[]> {
    try {
      const contactsResult = await chatService.getContacts({ lite: true })
      if (!contactsResult.success || !contactsResult.contacts) return []

      const officialContacts = contactsResult.contacts.filter(c => c.type === 'official')
      const usernames = officialContacts.map(c => c.username)
      const enrichment = await chatService.enrichSessionsContactInfo(usernames)
      const contactInfoMap = enrichment.success && enrichment.contacts ? enrichment.contacts : {}

      const root = this.configService.get('dbPath')
      const myWxid = this.configService.get('myWxid')
      const accountWxid = account || myWxid
      if (!root || !accountWxid) return []

      const dbDir = join(root, accountWxid, 'db_storage', 'message')
      const bizLatestTime: Record<string, number> = {}

      if (existsSync(dbDir)) {
        const bizDbFiles = readdirSync(dbDir).filter(f => f.startsWith('biz_message') && f.endsWith('.db'))
        for (const file of bizDbFiles) {
          const dbPath = join(dbDir, file)
          const name2idRes = await wcdbService.execQuery('message', dbPath, 'SELECT username FROM Name2Id')
          if (name2idRes.success && name2idRes.rows) {
            for (const row of name2idRes.rows) {
              const uname = row.username || row.user_name
              if (uname) {
                const md5 = createHash('md5').update(uname).digest('hex').toLowerCase()
                const tName = `Msg_${md5}`
                const timeRes = await wcdbService.execQuery('message', dbPath, `SELECT MAX(create_time) as max_time FROM ${tName}`)
                if (timeRes.success && timeRes.rows && timeRes.rows[0]?.max_time) {
                  const t = parseInt(timeRes.rows[0].max_time)
                  if (!isNaN(t)) bizLatestTime[uname] = Math.max(bizLatestTime[uname] || 0, t)
                }
              }
            }
          }
        }
      }

      const result: BizAccount[] = officialContacts.map(contact => {
        const uname = contact.username
        const info = contactInfoMap[uname]
        const lastTime = bizLatestTime[uname] || 0
        return {
          username: uname,
          name: info?.displayName || contact.displayName || uname,
          avatar: info?.avatarUrl || '',
          type: 0, 
          last_time: lastTime,
          formatted_last_time: lastTime ? new Date(lastTime * 1000).toISOString().split('T')[0] : ''
        }
      })

      const contactDbPath = join(root, accountWxid, 'contact.db')
      if (existsSync(contactDbPath)) {
        const bizInfoRes = await wcdbService.execQuery('contact', contactDbPath, 'SELECT username, type FROM biz_info')
        if (bizInfoRes.success && bizInfoRes.rows) {
          const typeMap: Record<string, number> = {}
          for (const r of bizInfoRes.rows) typeMap[r.username] = r.type
          for (const acc of result) if (typeMap[acc.username] !== undefined) acc.type = typeMap[acc.username]
        }
      }

      return result.sort((a, b) => {
        if (a.username === 'gh_3dfda90e39d6') return -1
        if (b.username === 'gh_3dfda90e39d6') return 1
        return b.last_time - a.last_time
      })
    } catch (e) { return [] }
  }

  async listMessages(username: string, account?: string, limit: number = 20, offset: number = 0): Promise<BizMessage[]> {
    console.log(`[BizService] listMessages: ${username}, limit=${limit}, offset=${offset}`)
    try {
      const rawMessages = await this.getBizRawMessages(username, account || '', limit, offset)
      
      const bizMessages: BizMessage[] = rawMessages.map(msg => {
        const bizMsg: BizMessage = {
          local_id: msg.localId,
          create_time: msg.createTime,
          title: msg.linkTitle || msg.parsedContent || '',
          des: msg.appMsgDesc || '',
          url: msg.linkUrl || '',
          cover: msg.linkThumb || msg.appMsgThumbUrl || '',
          content_list: []
        }
        if (msg.rawContent) {
          bizMsg.content_list = this.parseBizContentList(msg.rawContent)
          if (bizMsg.content_list.length > 0 && !bizMsg.title) {
            bizMsg.title = bizMsg.content_list[0].title
            bizMsg.cover = bizMsg.cover || bizMsg.content_list[0].cover
          }
        }
        return bizMsg
      })
      return bizMessages
    } catch (e) {
      console.error(`[BizService] listMessages error:`, e)
      return []
    }
  }

  async listPayRecords(account?: string, limit: number = 20, offset: number = 0): Promise<BizPayRecord[]> {
    const username = 'gh_3dfda90e39d6'
    try {
      const rawMessages = await this.getBizRawMessages(username, account || '', limit, offset)
      const records: BizPayRecord[] = []
      for (const msg of rawMessages) {
        if (!msg.rawContent) continue
        const parsedData = this.parsePayXml(msg.rawContent)
        if (parsedData) {
          records.push({
            local_id: msg.localId,
            create_time: msg.createTime,
            ...parsedData,
            timestamp: parsedData.timestamp || msg.createTime,
            formatted_time: new Date((parsedData.timestamp || msg.createTime) * 1000).toLocaleString()
          })
        }
      }
      return records
    } catch (e) { return [] }
  }

  registerHandlers() {
    ipcMain.handle('biz:listAccounts', (_, account) => this.listAccounts(account))
    ipcMain.handle('biz:listMessages', (_, username, account, limit, offset) => this.listMessages(username, account, limit, offset))
    ipcMain.handle('biz:listPayRecords', (_, account, limit, offset) => this.listPayRecords(account, limit, offset))
  }
}

export const bizService = new BizService()
