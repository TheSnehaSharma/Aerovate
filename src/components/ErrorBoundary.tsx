import { Component, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

/** Keeps a crashing child (e.g. WebGL unavailable) from taking down the whole app. */
export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Component crashed:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
