import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="page-inner narrow empty-block">
          <p>This view hit a problem and couldn't be shown.</p>
          <p className="muted small">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
