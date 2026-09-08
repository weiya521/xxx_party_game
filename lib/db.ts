import fs from "fs"
import path from "path"
import type { GameConfig } from "./game-data"

const ROOM_EXPIRY_HOURS = Number.parseInt(process.env.ROOM_EXPIRY_HOURS || "24", 10)
const ROOM_EXPIRY_MS = ROOM_EXPIRY_HOURS * 60 * 60 * 1000

// 游戏状态类型
export interface GameState {
  player1Position: number
  player2Position: number
  currentPlayer: 1 | 2
  skipNextTurn: { player1: boolean; player2: boolean }
  canRollAgain: boolean
  winner: string | null
  cells: any[]
  endpointCells: any[]
  lastUpdate: number
  isRolling?: boolean
  timerSeconds?: number
  timerRunning?: boolean
  timerDuration?: number
  player1Gender?: "male" | "female"
  player2Gender?: "male" | "female"
  taskChangedCells?: { [cellIndex: number]: boolean }
  player2Joined?: boolean
  config?: GameConfig // 添加房间配置字段
}

// 房间数据结构
interface RoomData {
  id: string
  state: GameState
  updatedAt: number
}

// 存储数据结构
interface StoreData {
  rooms: { [roomId: string]: RoomData }
  defaultConfig?: GameConfig
}

// ============== 存储方式选择 ==============
const DATABASE_URL = process.env.DATABASE_URL

if (typeof window === "undefined") {
  console.log(`[Storage] 使用 ${DATABASE_URL ? "MySQL" : "JSON 文件"} 存储`)
  console.log(`[Storage] 房间过期时限: ${ROOM_EXPIRY_HOURS} 小时`)
}

// JSON 文件存储路径
const dataDir = path.join(process.cwd(), "data")
const dataFile = path.join(dataDir, "rooms.json")

// 内存缓存
let memoryCache: StoreData | null = null

// ============== JSON 文件存储实现 ==============

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function readStore(): StoreData {
  if (memoryCache) {
    return memoryCache
  }

  ensureDataDir()

  if (fs.existsSync(dataFile)) {
    try {
      const data = fs.readFileSync(dataFile, "utf-8")
      memoryCache = JSON.parse(data)
      return memoryCache!
    } catch {
      memoryCache = { rooms: {} }
      return memoryCache
    }
  }

  memoryCache = { rooms: {} }
  return memoryCache
}

function writeStore(data: StoreData): void {
  ensureDataDir()
  memoryCache = data
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf-8")
}

// ============== MySQL 实现 ==============

let mysqlPool: any = null

async function getMySQLPool() {
  if (!DATABASE_URL) return null

  if (!mysqlPool) {
    try {
      const mysql = await import("mysql2/promise")
      const url = new URL(DATABASE_URL)

      mysqlPool = mysql.createPool({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ""),
      
        ssl: {
          rejectUnauthorized: false,
        },
      })

      // 初始化表
      await mysqlPool.execute(`
        CREATE TABLE IF NOT EXISTS game_rooms (
          id VARCHAR(10) PRIMARY KEY,
          state JSON NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `)

      await mysqlPool.execute(`
        CREATE TABLE IF NOT EXISTS game_config (
          id VARCHAR(20) PRIMARY KEY,
          config JSON NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `)
    } catch (error) {
      console.error("MySQL 连接失败:", error)
      return null
    }
  }

  return mysqlPool
}

// ============== 统一接口 ==============

export async function isDBAvailable(): Promise<boolean> {
  if (DATABASE_URL) {
    const pool = await getMySQLPool()
    return pool !== null
  }
  return true
}

export async function initDB(): Promise<boolean> {
  if (DATABASE_URL) {
    const pool = await getMySQLPool()
    return pool !== null
  }
  ensureDataDir()
  return true
}

export async function createRoom(roomId: string, state: GameState): Promise<boolean> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        await pool.execute(
          "INSERT INTO game_rooms (id, state, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), updated_at = VALUES(updated_at)",
          [roomId, JSON.stringify(state), Date.now()],
        )
        return true
      }
    }

    const store = readStore()
    store.rooms[roomId] = {
      id: roomId,
      state,
      updatedAt: Date.now(),
    }
    writeStore(store)
    return true
  } catch (error) {
    console.error("创建房间失败:", error)
    return false
  }
}

export async function getRoomState(roomId: string): Promise<GameState | null> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        const [rows] = await pool.execute("SELECT state FROM game_rooms WHERE id = ?", [roomId])
        if ((rows as any[]).length === 0) return null
        const state = (rows as any[])[0].state
        if (typeof state === "string") {
          return JSON.parse(state)
        }
        return state
      }
    }

    const store = readStore()
    const room = store.rooms[roomId]
    return room ? room.state : null
  } catch (error) {
    console.error("获取房间状态失败:", error)
    return null
  }
}

export async function updateRoomState(roomId: string, state: GameState): Promise<boolean> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        const [result] = await pool.execute("UPDATE game_rooms SET state = ?, updated_at = ? WHERE id = ?", [
          JSON.stringify(state),
          Date.now(),
          roomId,
        ])
        return (result as any).affectedRows > 0
      }
    }

    const store = readStore()
    if (!store.rooms[roomId]) {
      return false
    }
    store.rooms[roomId] = {
      id: roomId,
      state,
      updatedAt: Date.now(),
    }
    writeStore(store)
    return true
  } catch (error) {
    console.error("更新房间状态失败:", error)
    return false
  }
}

export async function roomExists(roomId: string): Promise<boolean> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        const [rows] = await pool.execute("SELECT 1 FROM game_rooms WHERE id = ?", [roomId])
        return (rows as any[]).length > 0
      }
    }

    const store = readStore()
    return !!store.rooms[roomId]
  } catch (error) {
    console.error("检查房间失败:", error)
    return false
  }
}

export async function cleanupRooms(): Promise<void> {
  try {
    const expiryTime = Date.now() - ROOM_EXPIRY_MS

    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        await pool.execute("DELETE FROM game_rooms WHERE updated_at < ?", [expiryTime])
        return
      }
    }

    const store = readStore()
    let changed = false
    for (const roomId in store.rooms) {
      if (store.rooms[roomId].updatedAt < expiryTime) {
        delete store.rooms[roomId]
        changed = true
      }
    }
    if (changed) {
      writeStore(store)
    }
  } catch (error) {
    console.error("清理房间失败:", error)
  }
}

export async function getDefaultConfig(): Promise<GameConfig | null> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        const [rows] = await pool.execute("SELECT config FROM game_config WHERE id = ?", ["default"])
        if ((rows as any[]).length === 0) return null
        const config = (rows as any[])[0].config
        if (typeof config === "string") {
          return JSON.parse(config)
        }
        return config
      }
    }

    const store = readStore()
    return store.defaultConfig || null
  } catch (error) {
    console.error("获取默认配置失败:", error)
    return null
  }
}

export async function saveDefaultConfig(config: GameConfig): Promise<boolean> {
  try {
    if (DATABASE_URL) {
      const pool = await getMySQLPool()
      if (pool) {
        await pool.execute(
          "INSERT INTO game_config (id, config, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = VALUES(updated_at)",
          ["default", JSON.stringify(config), Date.now()],
        )
        return true
      }
    }

    const store = readStore()
    store.defaultConfig = config
    writeStore(store)
    return true
  } catch (error) {
    console.error("保存默认配置失败:", error)
    return false
  }
}

export function verifyAdminPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    console.warn("[Security] ADMIN_PASSWORD 未设置，默认配置功能已禁用")
    return false
  }
  return password === adminPassword
}
