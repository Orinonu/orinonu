"use client";

import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

export class MissionViewBoundary extends Component<{ children: ReactNode; onRetry: () => Promise<void> }, { failed: boolean; retrying: boolean }> {
  state = { failed: false, retrying: false };
  private mounted = false;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidMount() { this.mounted = true; }
  componentWillUnmount() { this.mounted = false; }
  private retry = async () => {
    this.setState({ retrying: true });
    await this.props.onRetry();
    if (this.mounted) this.setState({ failed: false, retrying: false });
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="resource-state state-error" role="alert">
      <h2>Esta vista não pôde ser exibida</h2>
      <p>O contexto recebido não é compatível. A navegação e os dados do projeto foram preservados; tente consultar novamente.</p>
      <Button variant="outline" disabled={this.state.retrying} onClick={() => void this.retry()}>Tentar novamente</Button>
    </section>;
  }
}
