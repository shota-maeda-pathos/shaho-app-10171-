import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SessionTimeoutService } from './core/services/session-timeout.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private sessionTimeout = inject(SessionTimeoutService);
  protected readonly title = signal('src');

  ngOnInit() {
    this.sessionTimeout.start();
  }
}
