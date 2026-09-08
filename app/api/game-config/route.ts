import { NextResponse } from "next/server"
import { defaultGameConfig } from "@/lib/game-data"
import { getDefaultConfig } from "@/lib/db"

export async function GET() {
  try {
    const config = await getDefaultConfig()

    // 数据库中还没有默认配置时，
    // 返回代码内置的默认配置
    return NextResponse.json(config ?? defaultGameConfig)

  } catch (error) {
    console.error("获取配置失败:", error)

    return NextResponse.json(defaultGameConfig)
  }
}

export async function POST(request: Request) {
  try {
    await request.json()

    return NextResponse.json({
      success: true
    })

  } catch (error) {
    return NextResponse.json(
      { error: "保存失败" },
      { status: 500 }
    )
  }
}
