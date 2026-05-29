import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can log the error to an external service here
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] caught error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, border: '1px solid #f5c6cb', background: '#f8d7da', color: '#721c24', borderRadius: 6 }}>
          <h3>Something went wrong in this component.</h3>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{String(this.state.error && this.state.error.toString())}</div>
          <details style={{ marginTop: 8 }}>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
