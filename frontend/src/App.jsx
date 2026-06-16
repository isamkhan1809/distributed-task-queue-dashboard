import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

const API = 'http://localhost:8000'
const WS_URL = 'ws://localhost:8000/ws'

const TASK_CONFIGS = {
  'worker.tasks.process_data': {
    label: 'Process Data',
    params: [
      { key: 'data_size', label: 'Data Size (rows)', type: 'number', default: 100 },
      { key: 'fail_rate', label: 'Fail Rate (0-1)', type: 'number', default: 0.1 },
    ],
  },
  'worker.tasks.send_email': {
    label: 'Send Email',
    params: [
      { key: 'recipient', label: 'Recipient Email', type: 'text', default: 'user@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', default: 'Hello from Celery' },
    ],
  },
  'worker.tasks.generate_report': {
    label: 'Generate Report',
    params: [
      { key: 'report_type', label: 'Type (pdf/csv/html)', type: 'text', default: 'pdf' },
      { key: 'pages', label: 'Pages', type: 'number', default: 10 },
    ],
  },
  'worker.tasks.scrape_url': {
    label: 'Scrape URL',
    params: [
      { key: 'url', label: 'URL', type: 'text', default: 'https://example.com' },
    ],
  },
  'worker.tasks.train_model': {
    label: 'Train ML Model',
    params: [
      { key: 'epochs', label: 'Epochs', type: 'number', default: 5 },
      { key: 'dataset_size', label: 'Dataset Size', type: 'number', default: 1000 },
    ],
  },
}

const STATE_ICONS = {
  PENDING: '○',
  STARTED: '◎',
  SUCCESS: '✓',
  FAILURE: '✗',
  RETRY: '↺',
}

function shortTaskName(name) {
  return name?.split('.').pop() ?? name
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

// ===== STAT CARD =====
function StatCard({ label, value, colorClass }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${colorClass}`}>{value ?? 0}</span>
    </div>
  )
}

// ===== WORKER CARD =====
function WorkerCard({ worker }) {
  return (
    <div className="worker-card">
      <div className="worker-name" title={worker.worker_name}>{worker.worker_name}</div>
      <span className={`badge ${worker.status}`}>{worker.status}</span>
      <div className="worker-info">
        <div className="worker-stat"><span>Active</span><span>{worker.active_tasks}</span></div>
        <div className="worker-stat"><span>Processed</span><span>{worker.processed}</span></div>
        <div className="worker-stat"><span>Concurrency</span><span>{worker.concurrency ?? 4}</span></div>
      </div>
    </div>
  )
}

// ===== QUEUE BARS =====
function QueueBars({ lengths }) {
  const maxVal = Math.max(...Object.values(lengths), 1)
  const queues = [
    { key: 'data', label: 'Data Queue', cls: 'data' },
    { key: 'email', label: 'Email Queue', cls: 'email' },
    { key: 'reports', label: 'Reports Queue', cls: 'reports' },
    { key: 'celery', label: 'Default Queue', cls: 'celery' },
  ]
  return (
    <div className="queue-bars">
      {queues.map(({ key, label, cls }) => (
        <div key={key} className="queue-row">
          <div className="queue-header">
            <span className="queue-name">{label}</span>
            <span className="queue-count">{lengths[key] ?? 0} jobs</span>
          </div>
          <div className="queue-track">
            <div
              className={`queue-fill ${cls}`}
              style={{ width: `${Math.max(2, ((lengths[key] ?? 0) / maxVal) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ===== SUBMIT PANEL =====
function SubmitPanel({ onSubmit }) {
  const [taskName, setTaskName] = useState('worker.tasks.process_data')
  const [params, setParams] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const config = TASK_CONFIGS[taskName]

  useEffect(() => {
    const defaults = {}
    config.params.forEach(p => { defaults[p.key] = p.default })
    setParams(defaults)
    setResult(null)
  }, [taskName])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    try {
      const kwargs = {}
      config.params.forEach(p => {
        kwargs[p.key] = p.type === 'number' ? Number(params[p.key]) : params[p.key]
      })
      const res = await axios.post(`${API}/tasks/submit`, { task_name: taskName, kwargs })
      setResult({ ok: true, message: `Submitted! Task ID: ${res.data.task_id}`, taskId: res.data.task_id })
      onSubmit(res.data)
    } catch (err) {
      setResult({ ok: false, message: err.response?.data?.detail ?? 'Submission failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="submit-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label">Task Type</label>
        <select className="form-select" value={taskName} onChange={e => setTaskName(e.target.value)}>
          {Object.entries(TASK_CONFIGS).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Parameters</label>
        <div className="params-grid">
          {config.params.map(p => (
            <div key={p.key} className="form-group">
              <label className="form-label">{p.label}</label>
              <input
                className="form-input"
                type={p.type}
                value={params[p.key] ?? p.default}
                onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                step={p.type === 'number' ? 'any' : undefined}
              />
            </div>
          ))}
        </div>
      </div>
      <button className="submit-btn" type="submit" disabled={loading}>
        {loading ? 'Submitting…' : '⚡ Submit Job'}
      </button>
      {result && (
        <div className={`submit-result ${result.ok ? '' : 'error'}`}>
          {result.message}
        </div>
      )}
    </form>
  )
}

// ===== TASK ITEM =====
function TaskItem({ task, onClick }) {
  const state = task.state ?? 'PENDING'
  return (
    <div className="task-item" onClick={() => onClick(task)}>
      <div className={`task-state-icon ${state}`}>{STATE_ICONS[state] ?? '?'}</div>
      <div className="task-info">
        <div className="task-name">{shortTaskName(task.name)}</div>
        <div className="task-meta">
          {task.id?.slice(0, 8)}… · {task.queue ?? 'celery'} · {timeAgo(task.submitted_at || task.date_done)}
        </div>
      </div>
      <span className={`badge ${state}`}>{state}</span>
    </div>
  )
}

// ===== TASK DRAWER =====
function TaskDrawer({ task, onClose }) {
  if (!task) return null
  const state = task.state ?? 'PENDING'

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-header">
          <span className="drawer-title">{shortTaskName(task.name)}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <div className="detail-section">
            <div className="detail-label">Status</div>
            <div><span className={`badge ${state}`}>{state}</span></div>
          </div>
          <div className="detail-section">
            <div className="detail-label">Task ID</div>
            <div className="detail-value">{task.id}</div>
          </div>
          <div className="detail-section">
            <div className="detail-label">Task Name</div>
            <div className="detail-value">{task.name}</div>
          </div>
          {task.queue && (
            <div className="detail-section">
              <div className="detail-label">Queue</div>
              <div className="detail-value">{task.queue}</div>
            </div>
          )}
          {(task.kwargs && Object.keys(task.kwargs).length > 0) && (
            <div className="detail-section">
              <div className="detail-label">Arguments</div>
              <div className="detail-value">{JSON.stringify(task.kwargs, null, 2)}</div>
            </div>
          )}
          {task.args && task.args.length > 0 && (
            <div className="detail-section">
              <div className="detail-label">Args</div>
              <div className="detail-value">{JSON.stringify(task.args, null, 2)}</div>
            </div>
          )}
          {task.result != null && (
            <div className="detail-section">
              <div className="detail-label">Result</div>
              <div className={`detail-value ${state === 'SUCCESS' ? 'success' : ''}`}>
                {typeof task.result === 'object' ? JSON.stringify(task.result, null, 2) : String(task.result)}
              </div>
            </div>
          )}
          {task.traceback && (
            <div className="detail-section">
              <div className="detail-label">Traceback</div>
              <div className="detail-value error">{task.traceback}</div>
            </div>
          )}
          {task.submitted_at && (
            <div className="detail-section">
              <div className="detail-label">Submitted</div>
              <div className="detail-value">{new Date(task.submitted_at).toLocaleString()}</div>
            </div>
          )}
          {task.date_done && (
            <div className="detail-section">
              <div className="detail-label">Completed</div>
              <div className="detail-value">{new Date(task.date_done).toLocaleString()}</div>
            </div>
          )}
          {task.worker && (
            <div className="detail-section">
              <div className="detail-label">Worker</div>
              <div className="detail-value">{task.worker}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== MAIN APP =====
export default function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [wsStatus, setWsStatus] = useState('disconnected')
  const [selectedTask, setSelectedTask] = useState(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setWsStatus('connected')
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'snapshot') setSnapshot(msg.data)
      } catch {}
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      reconnectRef.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connectWs()
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [connectWs])

  const stats = snapshot?.stats ?? {}
  const workers = snapshot?.workers ?? []
  const queueLengths = snapshot?.queue_lengths ?? {}
  const sessionTasks = snapshot?.session_tasks ?? []
  const activeTasks = snapshot?.active_tasks ?? []

  // Merge session tasks with active tasks for the feed
  const feedTasks = (() => {
    const map = new Map()
    // Active tasks from worker
    activeTasks.forEach(t => map.set(t.id, { ...t, state: 'STARTED' }))
    // Session tasks (submitted from this UI)
    sessionTasks.forEach(t => {
      if (map.has(t.id)) {
        map.set(t.id, { ...map.get(t.id), ...t })
      } else {
        map.set(t.id, t)
      }
    })
    return Array.from(map.values()).sort((a, b) => {
      const order = { STARTED: 0, PENDING: 1, RETRY: 2, SUCCESS: 3, FAILURE: 3 }
      return (order[a.state] ?? 4) - (order[b.state] ?? 4)
    })
  })()

  return (
    <>
      <header className="header">
        <div className="header-left">
          <span style={{ fontSize: 24 }}>⚡</span>
          <div>
            <div className="header-title">Distributed Task Queue Dashboard</div>
            <div className="header-subtitle">Celery · Redis · FastAPI · Real-Time</div>
          </div>
        </div>
        <div className="ws-indicator">
          <div className={`ws-dot ${wsStatus === 'connected' ? 'connected' : ''}`} />
          <span>{wsStatus === 'connected' ? 'Live' : 'Connecting…'}</span>
        </div>
      </header>

      <main className="app-container">
        {/* Stat Cards */}
        <div className="stats-row">
          <StatCard label="Active Tasks" value={stats.active} colorClass="active" />
          <StatCard label="Queued" value={stats.queued} colorClass="queued" />
          <StatCard label="Completed" value={stats.completed} colorClass="completed" />
          <StatCard label="Failed" value={stats.failed} colorClass="failed" />
          <StatCard label="Workers Online" value={stats.workers_online} colorClass="workers" />
        </div>

        <div className="main-grid">
          {/* Workers */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">⚙️ Workers</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{workers.length} registered</span>
            </div>
            {workers.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🤖</div>
                <div>No workers detected. Start Celery workers to see them here.</div>
              </div>
            ) : (
              <div className="worker-grid">
                {workers.map(w => <WorkerCard key={w.worker_name} worker={w} />)}
              </div>
            )}
          </div>

          {/* Queue Depths */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">📊 Queue Depths</span>
            </div>
            <QueueBars lengths={queueLengths} />
          </div>

          {/* Submit Job */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">🚀 Submit Job</span>
            </div>
            <SubmitPanel onSubmit={() => {}} />
          </div>

          {/* Live Task Feed */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">📡 Live Task Feed</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{feedTasks.length} tasks</span>
            </div>
            {feedTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <div>No tasks yet. Submit a job to get started!</div>
              </div>
            ) : (
              <div className="task-feed">
                {feedTasks.map(task => (
                  <TaskItem key={task.id} task={task} onClick={setSelectedTask} />
                ))}
              </div>
            )}
          </div>

          {/* Recent Tasks History (full width) */}
          <div className="panel full-width">
            <div className="panel-header">
              <span className="panel-title">🕘 Recent Task History</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {(snapshot?.recent_tasks ?? []).length} records
              </span>
            </div>
            {(snapshot?.recent_tasks ?? []).length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <div>No completed tasks in history yet.</div>
              </div>
            ) : (
              <div className="task-feed">
                {(snapshot?.recent_tasks ?? []).slice(0, 30).map(task => (
                  <TaskItem key={task.id} task={task} onClick={setSelectedTask} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </>
  )
}
