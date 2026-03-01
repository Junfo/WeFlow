import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, MessageSquare, BarChart3, Users, FileText, Database, Settings, ChevronLeft, ChevronRight, Download, Aperture, UserCircle, Lock } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import * as configService from '../services/config'

import './Sidebar.scss'

interface SidebarUserProfile {
  wxid: string
  displayName: string
  avatarUrl?: string
}

const SIDEBAR_USER_PROFILE_CACHE_KEY = 'sidebar_user_profile_cache_v1'

interface SidebarUserProfileCache extends SidebarUserProfile {
  updatedAt: number
}

const readSidebarUserProfileCache = (): SidebarUserProfile | null => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_USER_PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SidebarUserProfileCache
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.wxid || !parsed.displayName) return null
    return {
      wxid: parsed.wxid,
      displayName: parsed.displayName,
      avatarUrl: parsed.avatarUrl
    }
  } catch {
    return null
  }
}

const writeSidebarUserProfileCache = (profile: SidebarUserProfile): void => {
  if (!profile.wxid || !profile.displayName) return
  try {
    const payload: SidebarUserProfileCache = {
      ...profile,
      updatedAt: Date.now()
    }
    window.localStorage.setItem(SIDEBAR_USER_PROFILE_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // 忽略本地缓存失败，不影响主流程
  }
}

function Sidebar() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [userProfile, setUserProfile] = useState<SidebarUserProfile>({
    wxid: '',
    displayName: '未识别用户'
  })
  const setLocked = useAppStore(state => state.setLocked)

  useEffect(() => {
    window.electronAPI.auth.verifyEnabled().then(setAuthEnabled)
  }, [])

  useEffect(() => {
    const loadCurrentUser = async () => {
      const patchUserProfile = (patch: Partial<SidebarUserProfile>, expectedWxid?: string) => {
        setUserProfile(prev => {
          if (expectedWxid && prev.wxid && prev.wxid !== expectedWxid) {
            return prev
          }
          const next: SidebarUserProfile = {
            ...prev,
            ...patch
          }
          if (!next.displayName) {
            next.displayName = next.wxid || '未识别用户'
          }
          writeSidebarUserProfileCache(next)
          return next
        })
      }

      try {
        const wxid = await configService.getMyWxid()
        const resolvedWxid = wxid || ''
        const cleanedWxidMatch = resolvedWxid.match(/^(wxid_[^_]+)/i)
        const cleanedWxid = cleanedWxidMatch?.[1] || resolvedWxid
        const wxidCandidates = new Set<string>([
          resolvedWxid.trim().toLowerCase(),
          cleanedWxid.trim().toLowerCase()
        ].filter(Boolean))

        const normalizeName = (value?: string | null): string | undefined => {
          if (!value) return undefined
          const trimmed = value.trim()
          if (!trimmed) return undefined
          const lowered = trimmed.toLowerCase()
          if (lowered === 'self') return undefined
          if (lowered.startsWith('wxid_')) return undefined
          if (wxidCandidates.has(lowered)) return undefined
          return trimmed
        }

        const pickFirstValidName = (...candidates: Array<string | null | undefined>): string | undefined => {
          for (const candidate of candidates) {
            const normalized = normalizeName(candidate)
            if (normalized) return normalized
          }
          return undefined
        }

        const fallbackDisplayName = resolvedWxid || '未识别用户'

        // 第一阶段：先把 wxid/名称打上，保证侧边栏第一时间可见。
        patchUserProfile({
          wxid: resolvedWxid,
          displayName: fallbackDisplayName
        })

        if (!resolvedWxid) return

        // 第二阶段：后台补齐名称（不会阻塞首屏）。
        void (async () => {
          try {
            const myContact = await window.electronAPI.chat.getContact(resolvedWxid)
            const fromContact = pickFirstValidName(
              myContact?.remark,
              myContact?.nickName,
              myContact?.alias
            )

            if (fromContact) {
              patchUserProfile({ displayName: fromContact }, resolvedWxid)
              return
            }

            const enrichTargets = Array.from(new Set([resolvedWxid, cleanedWxid, 'self'].filter(Boolean)))
            const enrichedResult = await window.electronAPI.chat.enrichSessionsContactInfo(enrichTargets)
            const enrichedDisplayName = pickFirstValidName(
              enrichedResult.contacts?.[resolvedWxid]?.displayName,
              enrichedResult.contacts?.[cleanedWxid]?.displayName,
              enrichedResult.contacts?.self?.displayName,
              myContact?.alias
            )
            const bestName = enrichedDisplayName
            if (bestName) {
              patchUserProfile({ displayName: bestName }, resolvedWxid)
            }
          } catch (nameError) {
            console.error('加载侧边栏用户昵称失败:', nameError)
          }
        })()

        // 第二阶段：后台补齐头像（不会阻塞首屏）。
        void (async () => {
          try {
            const avatarResult = await window.electronAPI.chat.getMyAvatarUrl()
            if (avatarResult.success && avatarResult.avatarUrl) {
              patchUserProfile({ avatarUrl: avatarResult.avatarUrl }, resolvedWxid)
            }
          } catch (avatarError) {
            console.error('加载侧边栏用户头像失败:', avatarError)
          }
        })()
      } catch (error) {
        console.error('加载侧边栏用户信息失败:', error)
      }
    }

    const cachedProfile = readSidebarUserProfileCache()
    if (cachedProfile) {
      setUserProfile(prev => ({
        ...prev,
        ...cachedProfile
      }))
    }

    void loadCurrentUser()
    const onWxidChanged = () => { void loadCurrentUser() }
    window.addEventListener('wxid-changed', onWxidChanged as EventListener)
    return () => window.removeEventListener('wxid-changed', onWxidChanged as EventListener)
  }, [])

  const getAvatarLetter = (name: string): string => {
    if (!name) return '?'
    return [...name][0] || '?'
  }

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="nav-menu">
        {/* 首页 */}
        <NavLink
          to="/home"
          className={`nav-item ${isActive('/home') ? 'active' : ''}`}
          title={collapsed ? '首页' : undefined}
        >
          <span className="nav-icon"><Home size={20} /></span>
          <span className="nav-label">首页</span>
        </NavLink>

        {/* 聊天 */}
        <NavLink
          to="/chat"
          className={`nav-item ${isActive('/chat') ? 'active' : ''}`}
          title={collapsed ? '聊天' : undefined}
        >
          <span className="nav-icon"><MessageSquare size={20} /></span>
          <span className="nav-label">聊天</span>
        </NavLink>

        {/* 朋友圈 */}
        <NavLink
          to="/sns"
          className={`nav-item ${isActive('/sns') ? 'active' : ''}`}
          title={collapsed ? '朋友圈' : undefined}
        >
          <span className="nav-icon"><Aperture size={20} /></span>
          <span className="nav-label">朋友圈</span>
        </NavLink>

        {/* 通讯录 */}
        <NavLink
          to="/contacts"
          className={`nav-item ${isActive('/contacts') ? 'active' : ''}`}
          title={collapsed ? '通讯录' : undefined}
        >
          <span className="nav-icon"><UserCircle size={20} /></span>
          <span className="nav-label">通讯录</span>
        </NavLink>

        {/* 私聊分析 */}
        <NavLink
          to="/analytics"
          className={`nav-item ${isActive('/analytics') ? 'active' : ''}`}
          title={collapsed ? '私聊分析' : undefined}
        >
          <span className="nav-icon"><BarChart3 size={20} /></span>
          <span className="nav-label">私聊分析</span>
        </NavLink>

        {/* 群聊分析 */}
        <NavLink
          to="/group-analytics"
          className={`nav-item ${isActive('/group-analytics') ? 'active' : ''}`}
          title={collapsed ? '群聊分析' : undefined}
        >
          <span className="nav-icon"><Users size={20} /></span>
          <span className="nav-label">群聊分析</span>
        </NavLink>

        {/* 年度报告 */}
        <NavLink
          to="/annual-report"
          className={`nav-item ${isActive('/annual-report') ? 'active' : ''}`}
          title={collapsed ? '年度报告' : undefined}
        >
          <span className="nav-icon"><FileText size={20} /></span>
          <span className="nav-label">年度报告</span>
        </NavLink>

        {/* 导出 */}
        <NavLink
          to="/export"
          className={`nav-item ${isActive('/export') ? 'active' : ''}`}
          title={collapsed ? '导出' : undefined}
        >
          <span className="nav-icon"><Download size={20} /></span>
          <span className="nav-label">导出</span>
        </NavLink>


      </nav>

      <div className="sidebar-footer">
        <div
          className="sidebar-user-card"
          title={collapsed ? `${userProfile.displayName}${userProfile.wxid ? `\n${userProfile.wxid}` : ''}` : undefined}
        >
          <div className="user-avatar">
            {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : <span>{getAvatarLetter(userProfile.displayName)}</span>}
          </div>
          <div className="user-meta">
            <div className="user-name">{userProfile.displayName}</div>
            <div className="user-wxid">{userProfile.wxid || 'wxid 未识别'}</div>
          </div>
        </div>

        {authEnabled && (
          <button
            className="nav-item"
            onClick={() => setLocked(true)}
            title={collapsed ? '锁定' : undefined}
          >
            <span className="nav-icon"><Lock size={20} /></span>
            <span className="nav-label">锁定</span>
          </button>
        )}

        <NavLink
          to="/settings"
          className={`nav-item ${isActive('/settings') ? 'active' : ''}`}
          title={collapsed ? '设置' : undefined}
        >
          <span className="nav-icon">
            <Settings size={20} />
          </span>
          <span className="nav-label">设置</span>
        </NavLink>

        <button
          className="collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
