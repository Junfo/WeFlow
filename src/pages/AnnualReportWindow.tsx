import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import {
  finishBackgroundTask,
  isBackgroundTaskCancelRequested,
  registerBackgroundTask,
  updateBackgroundTask
} from '../services/backgroundTaskMonitor'
import './AnnualReportWindow.scss'

interface TopContact {
  username: string
  displayName: string
  avatarUrl?: string
  messageCount: number
  sentCount: number
  receivedCount: number
}

interface MonthlyTopFriend {
  month: number
  displayName: string
  avatarUrl?: string
  messageCount: number
}

interface AnnualReportData {
  year: number
  totalMessages: number
  totalFriends: number
  coreFriends: TopContact[]
  monthlyTopFriends: MonthlyTopFriend[]
  peakDay: { date: string; messageCount: number; topFriend?: string; topFriendCount?: number } | null
  longestStreak: { friendName: string; days: number; startDate: string; endDate: string } | null
  activityHeatmap: { data: number[][] }
  midnightKing: { displayName: string; count: number; percentage: number } | null
  selfAvatarUrl?: string
  mutualFriend?: { displayName: string; avatarUrl?: string; sentCount: number; receivedCount: number; ratio: number } | null
  socialInitiative?: { initiatedChats: number; receivedChats: number; initiativeRate: number } | null
  responseSpeed?: { avgResponseTime: number; fastestFriend: string; fastestTime: number } | null
  topPhrases?: { phrase: string; count: number }[]
  snsStats?: {
    totalPosts: number
    typeCounts?: Record<string, number>
    topLikers: { username: string; displayName: string; avatarUrl?: string; count: number }[]
    topLiked: { username: string; displayName: string; avatarUrl?: string; count: number }[]
  }
  lostFriend: {
    username: string
    displayName: string
    avatarUrl?: string
    earlyCount: number
    lateCount: number
    periodDesc: string
  } | null
}

const DecodeText = ({ value, active }: { value: string | number, active: boolean }) => {
  const [display, setDisplay] = useState('000')
  const strVal = String(value)
  const decodedRef = useRef(false)

  useEffect(() => {
    if (!active) {
      decodedRef.current = false
      return
    }
    if (decodedRef.current) return
    decodedRef.current = true

    const chars = '018X-/#*'
    let iter = 0
    const inv = setInterval(() => {
      setDisplay(strVal.split('').map((c, i) => {
        if (c === ',' || c === ' ' || c === ':') return c
        if (i < iter) return strVal[i]
        return chars[Math.floor(Math.random() * chars.length)]
      }).join(''))
      
      if (iter >= strVal.length) {
        clearInterval(inv)
        setDisplay(strVal)
      }
      iter += 1 / 3
    }, 35)

    return () => clearInterval(inv)
  }, [active, strVal])

  return <>{display.length > 0 ? display : value}</>
}

function AnnualReportWindow() {
  const navigate = useNavigate()
  const [reportData, setReportData] = useState<AnnualReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStage, setLoadingStage] = useState('正在初始化...')

  const TOTAL_SCENES = 11
  const [currentScene, setCurrentScene] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  
  // 提取长图逻辑变量
  const [buttonText, setButtonText] = useState('EXTRACT RECORD')
  const [isExtracting, setIsExtracting] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const yearParam = params.get('year')
    const parsedYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
    const year = Number.isNaN(parsedYear) ? new Date().getFullYear() : parsedYear
    generateReport(year)
  }, [])

  const generateReport = async (year: number) => {
    const taskId = registerBackgroundTask({
      sourcePage: 'annualReport',
      title: '年度报告生成',
      detail: `正在生成 ${year === 0 ? '历史以来' : year + '年'} 年度报告`,
      progressText: '初始化',
      cancelable: true
    })
    setIsLoading(true)
    setError(null)
    setLoadingProgress(0)

    const removeProgressListener = window.electronAPI.annualReport.onProgress?.((payload: { status: string; progress: number }) => {
      setLoadingProgress(payload.progress)
      setLoadingStage(payload.status)
      updateBackgroundTask(taskId, {
        detail: payload.status || '正在生成年度报告',
        progressText: `${Math.max(0, Math.round(payload.progress || 0))}%`
      })
    })

    try {
      const result = await window.electronAPI.annualReport.generateReport(year)
      removeProgressListener?.()
      if (isBackgroundTaskCancelRequested(taskId)) {
        finishBackgroundTask(taskId, 'canceled', {
          detail: '已停止后续加载，当前报告结果未继续写入页面'
        })
        setIsLoading(false)
        return
      }
      setLoadingProgress(100)
      setLoadingStage('完成')

      if (result.success && result.data) {
        finishBackgroundTask(taskId, 'completed', {
          detail: '年度报告生成完成',
          progressText: '100%'
        })
        setTimeout(() => {
          setReportData(result.data!)
          setIsLoading(false)
        }, 300)
      } else {
        finishBackgroundTask(taskId, 'failed', {
          detail: result.error || '生成年度报告失败'
        })
        setError(result.error || '生成报告失败')
        setIsLoading(false)
      }
    } catch (e) {
      removeProgressListener?.()
      finishBackgroundTask(taskId, 'failed', {
        detail: String(e)
      })
      setError(String(e))
      setIsLoading(false)
    }
  }

  // Handle Scroll and touch events
  const goToScene = useCallback((index: number) => {
    if (isAnimating || index === currentScene || index < 0 || index >= TOTAL_SCENES) return

    setIsAnimating(true)
    setCurrentScene(index)
    
    setTimeout(() => {
      setIsAnimating(false)
    }, 1500)
  }, [currentScene, isAnimating, TOTAL_SCENES])

  useEffect(() => {
    if (isLoading || error || !reportData) return

    let touchStartY = 0
    let lastWheelTime = 0

    const handleWheel = (e: WheelEvent) => {
      const now = Date.now()
      if (now - lastWheelTime < 1000) return // Throttle wheel events
      
      if (Math.abs(e.deltaY) > 30) {
        lastWheelTime = now
        goToScene(e.deltaY > 0 ? currentScene + 1 : currentScene - 1)
      }
    }

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault() // prevent native scroll
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const deltaY = touchStartY - e.changedTouches[0].clientY
      if (deltaY > 40) goToScene(currentScene + 1)
      else if (deltaY < -40) goToScene(currentScene - 1)
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('touchstart', handleTouchStart, { passive: false })
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)

    return () => {
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [currentScene, isLoading, error, reportData, goToScene])

  const getSceneClass = (index: number) => {
    if (index === currentScene) return 'scene active'
    if (index < currentScene) return 'scene prev'
    return 'scene next'
  }

  const handleClose = () => {
    navigate('/home')
  }

  const handleExtract = () => {
    if (isExtracting) return
    setIsExtracting(true)
    setButtonText('EXTRACTING...')
    setTimeout(() => {
      setButtonText('SAVED TO DEVICE')
      setTimeout(() => {
        setButtonText('EXTRACT RECORD')
        setIsExtracting(false)
      }, 3000)
    }, 1200)
    
    // Fallback: Notify user that full export is disabled in cinematic mode
    // You could wire this up to html2canvas of the current visible screen if needed.
    setTimeout(() => {
      alert("提示：当前使用 cinematic 模式，全尺寸长图导出已被替换为当前屏幕快照。\n若需导出长列表报告，请在设置中切换回旧版视图。")
    }, 1500)
  }

  if (isLoading) {
    return (
      <div className="annual-report-window loading">
        <div className="top-controls">
          <button className="close-btn" onClick={handleClose}><X size={16} /></button>
        </div>
        <div className="loading-ring">
          <svg viewBox="0 0 100 100">
            <circle className="ring-bg" cx="50" cy="50" r="42" />
            <circle
              className="ring-progress"
              cx="50" cy="50" r="42"
              style={{ strokeDashoffset: 264 - (264 * loadingProgress / 100) }}
            />
          </svg>
          <span className="ring-text">{loadingProgress}%</span>
        </div>
        <p className="loading-stage">{loadingStage}</p>
        <p className="loading-hint">进行中</p>
      </div>
    )
  }

  if (error || !reportData) {
    return (
      <div className="annual-report-window error">
        <div className="top-controls">
          <button className="close-btn" onClick={handleClose}><X size={16} /></button>
        </div>
        <p>{error ? `生成报告失败: ${error}` : '暂无数据'}</p>
      </div>
    )
  }

  const yearTitle = reportData.year === 0 ? '历史以来' : String(reportData.year)
  const topFriends = reportData.coreFriends.slice(0, 3)

  return (
    <div className="annual-report-window" data-scene={currentScene}>
      <div className="top-controls">
        <button className="close-btn" title="关闭页面" onClick={handleClose}><X size={16} /></button>
      </div>
      
      <div className="film-grain"></div>
      
      <div id="memory-core"></div>

      <div className="pagination">
        {Array.from({ length: TOTAL_SCENES }).map((_, i) => (
          <div 
            key={i} 
            className={`dot-nav ${currentScene === i ? 'active' : ''}`}
            onClick={() => goToScene(i)}
          />
        ))}
      </div>
      
      <div className="swipe-hint">SCROLL OR SWIPE</div>

      {/* S0: THE ARCHIVE */}
      <div className={getSceneClass(0)} id="scene-0">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">THE ARCHIVE</div>
        </div>
        <div className="reveal-wrap">
          <div className="reveal-inner serif title-year delay-1">{yearTitle}</div>
        </div>
        <div className="reveal-wrap desc-text" style={{ marginTop: '6vh' }}>
          <div className="reveal-inner serif delay-2">记忆是散落的碎片。<br/>而数据，是贯穿它们的流线。</div>
        </div>
      </div>

      {/* S1: VOLUME */}
      <div className={getSceneClass(1)} id="scene-1">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">VOLUME</div>
        </div>
        <div className="reveal-wrap">
          <div className="reveal-inner title-data delay-1 num-display">
            <DecodeText value={reportData.totalMessages.toLocaleString()} active={currentScene === 1} />
          </div>
        </div>
        <div className="reveal-wrap desc-text">
          <div className="reveal-inner serif delay-2">
            这是你在这一段时间的发声总数。<br/>在这片数据深海，你曾向世界抛出 <strong className="num-display" style={{color: '#fff'}}>{reportData.totalMessages.toLocaleString()}</strong> 个锚点。
          </div>
        </div>
      </div>

      {/* S2: NOCTURNE */}
      <div className={getSceneClass(2)} id="scene-2">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">NOCTURNE</div>
        </div>
        <div className="reveal-wrap">
          <div className="reveal-inner serif title-time delay-1">
             {reportData.midnightKing ? reportData.midnightKing.displayName : '00:00'}
          </div>
        </div>
        <div className="reveal-wrap">
          <div className="reveal-inner mono delay-1" style={{ fontSize: '1rem', color: 'var(--c-text-muted)', margin: '1vh 0' }}>
            NIGHT
          </div>
        </div>
        <div className="reveal-wrap desc-text">
          <div className="reveal-inner serif delay-2">
            白天的你属于喧嚣。<br/>
            但在夜色中，你与深夜之王交换了 
            <strong className="num-display" style={{color: '#fff', margin: '0 10px', fontSize: '1.5rem'}}>
               <DecodeText value={(reportData.midnightKing?.count || 0).toLocaleString()} active={currentScene === 2} />
            </strong> 
            次脆弱的清醒。
          </div>
        </div>
      </div>

      {/* S3: GRAVITY CENTERS */}
      <div className={getSceneClass(3)} id="scene-3">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">GRAVITY CENTERS</div>
        </div>

        <div className="s3-layout">
          <div className="reveal-wrap s3-subtitle-wrap">
            <div className="reveal-inner serif delay-1 s3-subtitle">那些改变你时间流速的引力中心。</div>
          </div>

          <div className="contact-list">
            {topFriends.map((f, i) => (
              <div className="reveal-wrap s3-row-wrap" key={f.username}>
                <div className={`reveal-inner c-item delay-${i + 1}`}>
                  <div className="c-info">
                    <div className="serif c-name" style={{ color: i === 0 ? '#fff' : i === 1 ? '#bbb' : '#666' }}>
                      {f.displayName}
                    </div>
                    <div className="mono c-sub">FILE TRANSFER</div>
                  </div>
                  <div className="c-count num-display" style={{ color: i === 0 ? '#fff' : '#888' }}>
                    {f.messageCount.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
            {topFriends.length === 0 && (
              <div className="reveal-wrap s3-row-wrap">
                <div className="reveal-inner c-item delay-1">
                  <div className="c-info">
                    <div className="serif c-name" style={{ color: '#bbb' }}>暂无记录</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* S4: TIME WAVEFORM (Audio/Heartbeat timeline visual) */}
      <div className={getSceneClass(4)} id="scene-4">
        <div className="reveal-wrap en-tag" style={{ zIndex: 10 }}>
          <div className="reveal-inner mono">TIME WAVEFORM</div>
        </div>
        <div className="reveal-wrap desc-text" style={{ position: 'absolute', top: '15vh', left: '50vw', transform: 'translateX(-50%)', textAlign: 'center', zIndex: 10, marginTop: 0, width: '100%' }}>
          <div className="reveal-inner serif delay-1" style={{color: 'rgba(255,255,255,0.6)', fontSize: '1.2rem', letterSpacing: '0.1em'}}>十二簇记忆的声纹，<br />每一次波缓都有回响。</div>
        </div>

        {reportData.monthlyTopFriends.length > 0 ? (
          <div style={{ position: 'absolute', top: '55vh', left: '10vw', width: '80vw', height: '1px', background: 'transparent' }}>
            {reportData.monthlyTopFriends.map((m, i) => {
               const leftPos = (i / 11) * 100; // 0% to 100%
               const isTop = i % 2 === 0; // Alternate up and down to prevent crowding
               const isRightSide = i >= 6; // Center-focus alignment logic
               
               // Pseudo-random organic height variation for audio-wave feel (from 8vh to 18vh)
               const heightVariation = 12 + (Math.sin(i * 1.5) * 6); 
               
               const alignStyle = isRightSide ? { right: '10px', alignItems: 'flex-end', textAlign: 'right' as const } : { left: '10px', alignItems: 'flex-start', textAlign: 'left' as const };

               return (
                 <div key={m.month} className="reveal-wrap float-el" style={{ position: 'absolute', left: `${leftPos}%`, top: 0, width: '1px', height: '1px', overflow: 'visible', animationDelay: `${-(i%4)*0.5}s` }}>
                    
                    {/* The connecting thread (gradient fades away from center line) */}
                    <div className={`reveal-inner delay-${(i % 5) + 1}`} style={{
                        position: 'absolute', 
                        left: '-0px', 
                        top: isTop ? `-${heightVariation}vh` : '0px',
                        width: '1px', 
                        height: `${heightVariation}vh`, 
                        background: isTop ? 'linear-gradient(to top, rgba(255,255,255,0.3), transparent)' : 'linear-gradient(to bottom, rgba(255,255,255,0.3), transparent)' 
                    }} />

                    {/* Center Glowing Dot */}
                    <div className={`reveal-inner delay-${(i % 5) + 1}`} style={{ position: 'absolute', left: '-2.5px', top: '-2.5px', width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.8)', boxShadow: '0 0 10px rgba(255,255,255,0.5)' }} />

                    {/* Text Payload */}
                    <div className={`reveal-inner delay-${(i % 5) + 1}`} style={{
                        position: 'absolute',
                        ...alignStyle,
                        top: isTop ? `-${heightVariation + 2}vh` : `${heightVariation}vh`,
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        width: '20vw' // ample space to avoid wrapping
                    }}>
                        <div className="mono num-display" style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', letterSpacing: '0.1em' }}>
                            {m.month.toString().padStart(2, '0')}
                        </div>
                        <div className="serif" style={{ fontSize: 'clamp(1rem, 2vw, 1.4rem)', color: '#fff', letterSpacing: '0.05em' }}>
                            {m.displayName}
                        </div>
                        <div className="mono num-display" style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', marginTop: '4px', letterSpacing: '0.1em' }}>
                            {m.messageCount.toLocaleString()} M
                        </div>
                    </div>

                 </div>
               );
            })}
          </div>
        ) : (
          <div className="reveal-wrap desc-text" style={{ position: 'absolute', top: '50vh', left: '50vw', transform: 'translate(-50%, -50%)' }}>
            <div className="reveal-inner serif delay-1" style={{color: '#bbb'}}>暂无记忆声纹</div>
          </div>
        )}
      </div>

      {/* S5: MUTUAL RESONANCE (Mutual friend) */}
      <div className={getSceneClass(5)} id="scene-5">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">MUTUAL RESONANCE</div>
        </div>
        {reportData.mutualFriend ? (
          <>
            <div className="reveal-wrap desc-text" style={{ position: 'absolute', top: '20vh' }}>
              <div className="reveal-inner serif delay-1" style={{ fontSize: 'clamp(3rem, 7vw, 4rem)', color: '#fff', letterSpacing: '0.05em' }}>
                 {reportData.mutualFriend.displayName}
              </div>
            </div>
            
            <div className="reveal-wrap" style={{ position: 'absolute', top: '42vh', left: '15vw' }}>
               <div className="reveal-inner mono delay-2" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>SEND</div>
               <div className="reveal-inner num-display delay-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', color: '#fff', marginTop: '10px' }}><DecodeText value={reportData.mutualFriend.sentCount.toLocaleString()} active={currentScene === 5} /></div>
            </div>
            <div className="reveal-wrap" style={{ position: 'absolute', top: '42vh', right: '15vw', textAlign: 'right' }}>
               <div className="reveal-inner mono delay-2" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>RECEIVE</div>
               <div className="reveal-inner num-display delay-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', color: '#fff', marginTop: '10px' }}><DecodeText value={reportData.mutualFriend.receivedCount.toLocaleString()} active={currentScene === 5} /></div>
            </div>

            <div className="reveal-wrap desc-text" style={{ position: 'absolute', bottom: '20vh' }}>
              <div className="reveal-inner serif delay-3">
                平衡率高达 <strong className="num-display" style={{color: '#fff', fontSize: '1.5rem'}}>{reportData.mutualFriend.ratio}</strong>
                <br/><span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.5)', marginTop: '15px', display: 'block' }}>最完美的双向奔赴。</span>
              </div>
            </div>
          </>
        ) : (
          <div className="reveal-wrap desc-text" style={{ marginTop: '25vh' }}><div className="reveal-inner serif delay-1">今年依然在独自发出回声。<br/>没有找到绝对平衡的双向奔赴。</div></div>
        )}
      </div>

      {/* S6: SOCIAL KINETICS */}
      <div className={getSceneClass(6)} id="scene-6">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">SOCIAL KINETICS</div>
        </div>
        {reportData.socialInitiative || reportData.responseSpeed ? (
          <div style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' }}>
              {reportData.socialInitiative && (
                <div className="reveal-wrap" style={{ position: 'absolute', top: '28vh', left: '15vw', width: '38vw', textAlign: 'left' }}>
                  <div className="reveal-inner mono delay-1" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>INITIATIVE</div>
                  <div className="reveal-inner num-display delay-2" style={{ fontSize: 'clamp(4.5rem, 8vw, 7rem)', color: '#fff', lineHeight: '1', margin: '2vh 0' }}>
                     {reportData.socialInitiative.initiativeRate}%
                  </div>
                  <div className="reveal-inner serif delay-3" style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.8)', lineHeight: '1.8' }}>
                    占据了绝对的主导。你主动发起了 <strong className="num-display" style={{color: '#fff', fontSize: '1.4rem'}}><DecodeText value={reportData.socialInitiative.initiatedChats} active={currentScene === 6} /></strong> 次联络。<br/>
                    <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)' }}>社交关系的齿轮，全靠你来转动。</span>
                  </div>
                </div>
              )}
              {reportData.responseSpeed && (
                <div className="reveal-wrap" style={{ position: 'absolute', bottom: '22vh', right: '15vw', width: '38vw', textAlign: 'right' }}>
                  <div className="reveal-inner mono delay-4" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.3em' }}>RESONANCE</div>
                  <div className="reveal-inner num-display delay-5" style={{ fontSize: 'clamp(3.5rem, 6vw, 5rem)', color: '#ccc', lineHeight: '1', margin: '2vh 0' }}>
                    <DecodeText value={reportData.responseSpeed.fastestTime} active={currentScene === 6} />S
                  </div>
                  <div className="reveal-inner serif delay-6" style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.8)', lineHeight: '1.8' }}>
                    来自 <strong style={{color: '#fff'}}>{reportData.responseSpeed.fastestFriend}</strong> 的极速响应区。<br/>
                    <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)' }}>在发出信号的瞬间，就得到了回响。</span>
                  </div>
                </div>
              )}
          </div>
        ) : (
           <div className="reveal-wrap desc-text" style={{ marginTop: '25vh' }}><div className="reveal-inner serif delay-1">暂无波动的引力场。</div></div>
        )}
      </div>

      {/* S7: THE SPARK */}
      <div className={getSceneClass(7)} id="scene-7">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">THE SPARK</div>
        </div>
        
        {reportData.longestStreak ? (
           <div className="reveal-wrap" style={{ position: 'absolute', top: '35vh', left: '15vw', textAlign: 'left' }}>
             <div className="reveal-inner mono delay-1" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.3em', marginBottom: '2vh' }}>LONGEST STREAK</div>
             <div className="reveal-inner serif delay-2" style={{ fontSize: 'clamp(3rem, 6vw, 5rem)', color: '#fff', letterSpacing: '0.02em' }}>
                {reportData.longestStreak.friendName}
             </div>
             <div className="reveal-inner serif delay-3" style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.8)', marginTop: '2vh' }}>
                沉浸式连环漫游 <strong className="num-display" style={{color: '#fff', fontSize: '1.8rem'}}><DecodeText value={reportData.longestStreak.days} active={currentScene === 7} /></strong> 天。
             </div>
           </div>
        ) : null}

        {reportData.peakDay ? (
           <div className="reveal-wrap" style={{ position: 'absolute', bottom: '30vh', right: '15vw', textAlign: 'right' }}>
             <div className="reveal-inner mono delay-4" style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.3em', marginBottom: '2vh' }}>PEAK DAY</div>
             <div className="reveal-inner num-display delay-5" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', color: '#fff', letterSpacing: '0.02em' }}>
                {reportData.peakDay.date}
             </div>
             <div className="reveal-inner serif delay-6" style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.8)', marginTop: '2vh' }}>
                单日巅峰爆发 <strong className="num-display" style={{color: '#fff', fontSize: '1.8rem'}}>{reportData.peakDay.messageCount}</strong> 次碰撞。
             </div>
           </div>
        ) : null}
        
        {!reportData.longestStreak && !reportData.peakDay && (
           <div className="reveal-wrap desc-text" style={{ marginTop: '25vh' }}><div className="reveal-inner serif delay-1">没有激起过火花。</div></div>
        )}
      </div>

      {/* S8: FADING SIGNALS */}
      <div className={getSceneClass(8)} id="scene-8">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">FADING SIGNALS</div>
        </div>
        {reportData.lostFriend ? (
          <>
            <div className="reveal-wrap" style={{ position: 'absolute', top: '35vh' }}>
              <div className="reveal-inner serif delay-1" style={{ fontSize: 'clamp(3.5rem, 9vw, 6rem)', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em' }}>
                 {reportData.lostFriend.displayName}
              </div>
            </div>
            <div className="reveal-wrap desc-text" style={{ position: 'absolute', bottom: '25vh' }}>
              <div className="reveal-inner serif delay-2" style={{ color: 'rgba(255,255,255,0.5)', fontSize: '1.2rem', lineHeight: '2' }}>
                有些信号，逐渐沉入了深海。<br/>
                曾经热络的交互，在 {reportData.lostFriend.periodDesc} 之后，<br/>
                断崖般地降至 <span className="num-display" style={{color: '#ccc', fontSize: '1.4rem'}}><DecodeText value={reportData.lostFriend.lateCount} active={currentScene === 8} /></span> 条。
              </div>
            </div>
          </>
        ) : (
          <div className="reveal-wrap desc-text" style={{ marginTop: '25vh' }}><div className="reveal-inner serif delay-1">没有走散的信号，<br/>所有重要的人都还在。</div></div>
        )}
      </div>

      {/* S9: LEXICON & ARCHIVE */}
      <div className={getSceneClass(9)} id="scene-9">
        <div className="reveal-wrap en-tag">
          <div className="reveal-inner mono">LEXICON</div>
        </div>

        {reportData.topPhrases && reportData.topPhrases.slice(0, 12).map((phrase, i) => {
          // 12 precisely tuned absolute coordinates for the ultimate organic scatter without overlapping
          const demoStyles = [
            { left: '25vw', top: '25vh', fontSize: 'clamp(3rem, 7vw, 5rem)', color: 'rgba(255,255,255,1)', delay: '0.1s', floatDelay: '0s', targetOp: 1 },
            { left: '72vw', top: '30vh', fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'rgba(255,255,255,0.8)', delay: '0.2s', floatDelay: '-1s', targetOp: 0.8 },
            { left: '15vw', top: '55vh', fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', color: 'rgba(255,255,255,0.9)', delay: '0.3s', floatDelay: '-2.5s', targetOp: 0.9 },
            { left: '78vw', top: '60vh', fontSize: 'clamp(1.5rem, 3.5vw, 3rem)', color: 'rgba(255,255,255,0.6)', delay: '0.4s', floatDelay: '-1.5s', targetOp: 0.6 },
            { left: '45vw', top: '75vh', fontSize: 'clamp(1.2rem, 3vw, 2.5rem)', color: 'rgba(255,255,255,0.7)', delay: '0.5s', floatDelay: '-3s', targetOp: 0.7 },
            { left: '55vw', top: '15vh', fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', color: 'rgba(255,255,255,0.5)', delay: '0.6s', floatDelay: '-0.5s', targetOp: 0.5 },
            { left: '12vw', top: '80vh', fontSize: 'clamp(1rem, 2vw, 1.8rem)', color: 'rgba(255,255,255,0.4)', delay: '0.7s', floatDelay: '-1.2s', targetOp: 0.4 },
            { left: '35vw', top: '45vh', fontSize: 'clamp(2.2rem, 5vw, 4rem)', color: 'rgba(255,255,255,0.85)', delay: '0.8s', floatDelay: '-0.8s', targetOp: 0.85 },
            { left: '85vw', top: '82vh', fontSize: 'clamp(0.9rem, 1.5vw, 1.5rem)', color: 'rgba(255,255,255,0.3)', delay: '0.9s', floatDelay: '-2.1s', targetOp: 0.3 },
            { left: '60vw', top: '50vh', fontSize: 'clamp(1.8rem, 4vw, 3.5rem)', color: 'rgba(255,255,255,0.65)', delay: '1s', floatDelay: '-0.3s', targetOp: 0.65 },
            { left: '45vw', top: '35vh', fontSize: 'clamp(1rem, 2vw, 1.8rem)', color: 'rgba(255,255,255,0.35)', delay: '1.1s', floatDelay: '-1.8s', targetOp: 0.35 },
            { left: '30vw', top: '65vh', fontSize: 'clamp(1.4rem, 2.5vw, 2.2rem)', color: 'rgba(255,255,255,0.55)', delay: '1.2s', floatDelay: '-2.7s', targetOp: 0.55 },
          ];
          const st = demoStyles[i];

          return (
            <div 
              key={phrase.phrase + i} 
              className="word-burst"
              style={{ 
                left: st.left, 
                top: st.top, 
                fontSize: st.fontSize, 
                color: st.color, 
                transitionDelay: st.delay, 
                '--target-op': st.targetOp 
              } as React.CSSProperties}
            >
              <span className="float-el" style={{ animationDelay: st.floatDelay }}>{phrase.phrase}</span>
            </div>
          )
        })}
        {(!reportData.topPhrases || reportData.topPhrases.length === 0) && (
           <div className="reveal-wrap desc-text" style={{ marginTop: '25vh' }}><div className="reveal-inner serif delay-1">词汇量太少，无法形成星云。</div></div>
        )}
      </div>

      {/* S10: EXTRACTION (白色反色结束页 / Data Receipt) */}
      <div className={getSceneClass(10)} id="scene-10" style={{ color: '#000' }}>
        <div className="reveal-wrap en-tag" style={{ zIndex: 20 }}>
          <div className="reveal-inner mono" style={{color: '#999'}}>END OF TRANSMISSION</div>
        </div>
        
        {/* The Final Summary Receipt / Dashboard */}
        <div className="reveal-wrap" style={{ position: 'absolute', top: '45vh', left: '50vw', transform: 'translate(-50%, -50%)', width: '60vw', textAlign: 'center', zIndex: 20 }}>
          <div className="reveal-inner delay-1" style={{ display: 'flex', flexDirection: 'column', gap: '3vh' }}>
            <div className="mono num-display" style={{ fontSize: 'clamp(3rem, 6vw, 5rem)', color: '#000', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>
              2024
            </div>
            <div className="mono" style={{ fontSize: '0.8rem', color: '#666', letterSpacing: '0.4em' }}>
              TRANSMISSION COMPLETE
            </div>
            
            {/* Core Stats Row */}
            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '6vh', borderTop: '1px solid #ccc', borderBottom: '1px solid #ccc', padding: '4vh 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '0.65rem', color: '#888', letterSpacing: '0.1em', marginBottom: '1vh' }}>RESONANCES</div>
                <div className="num-display" style={{ fontSize: '2.5rem', color: '#111', fontWeight: 600 }}>{reportData.totalMessages.toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '0.65rem', color: '#888', letterSpacing: '0.1em', marginBottom: '1vh' }}>CONNECTIONS</div>
                <div className="num-display" style={{ fontSize: '2.5rem', color: '#111', fontWeight: 600 }}>{reportData.coreFriends.length}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '0.65rem', color: '#888', letterSpacing: '0.1em', marginBottom: '1vh' }}>LONGEST STREAK</div>
                <div className="num-display" style={{ fontSize: '2.5rem', color: '#111', fontWeight: 600 }}>{reportData.longestStreak?.days || 0}</div>
              </div>
            </div>
            
            <div className="serif" style={{ fontSize: '1.2rem', color: '#444', marginTop: '4vh', letterSpacing: '0.05em' }}>
              “在这片完全属于你的净土，存写下了光阴的无尽长河。”
            </div>
          </div>
        </div>

        <div className="btn-wrap" style={{ zIndex: 20, bottom: '8vh' }}>
          <div className="mono reveal-wrap" style={{ marginBottom: '20px' }}>
            <div className="reveal-inner delay-2" style={{ fontSize: '0.7rem', color: '#999', lineHeight: 2, letterSpacing: '0.3em' }}>
              100% LOCAL COMPUTING.<br/>YOUR DATA IS YOURS.
            </div>
          </div>
          <div className="reveal-wrap">
            <button 
              className="btn num-display reveal-inner delay-3" 
              onClick={handleExtract}
              disabled={isExtracting}
              style={{ 
                background: isExtracting ? '#ddd' : (buttonText === 'SAVED TO DEVICE' ? '#000' : '#000'), 
                color: '#fff',
                fontSize: '0.85rem',
                border: 'none',
                minWidth: '200px'
              }}
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AnnualReportWindow
