import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import {
  Banknote, Bell, BookOpen, Boxes, Building2, Calendar, Check, ChevronDown, ChevronRight, CircleAlert,
  CircleCheck, Clock, Coins, Container, Download, Ellipsis, Eye, Factory, FileSpreadsheet, FileText,
  Globe, Handshake, Inbox, Info, Landmark, LayoutDashboard, Lock, LogOut, Menu, Package, Palette,
  Pencil, PiggyBank, Plus, Receipt, RotateCcw, Scale, Search, Send, Settings, ShieldCheck, Trash2,
  TrendingUp, TriangleAlert, Truck, Upload, Users, Wallet, X, ArrowRight,
  ArrowUp, Bold, ChevronUp, ChevronsUpDown, CircleX, Eraser, EyeOff, Italic, KeyRound, Link, List,
  ListOrdered, LogIn, Mail, Minus, Save, Underline, Unlink, User, ListFilter, ChevronLeft, ChevronsLeft,
  ChevronsRight, ArrowUpDown, Wifi, WifiOff,
} from 'lucide';

/** Lucide icons used by the portal. Add a name here to use it as <app-icon name="..."/>. */
const ICONS = {
  'arrow-right': ArrowRight, 'arrow-up': ArrowUp, alert: TriangleAlert, banknote: Banknote, bell: Bell,
  bold: Bold, book: BookOpen, 'chevron-up': ChevronUp, 'chevrons-up-down': ChevronsUpDown,
  'circle-x': CircleX, eraser: Eraser, 'eye-off': EyeOff, italic: Italic, key: KeyRound, link: Link,
  list: List, 'list-ordered': ListOrdered, 'log-in': LogIn, mail: Mail, minus: Minus, save: Save,
  underline: Underline, unlink: Unlink, user: User, filter: ListFilter, 'chevron-left': ChevronLeft,
  'chevrons-left': ChevronsLeft, 'chevrons-right': ChevronsRight, 'arrow-up-down': ArrowUpDown, wifi: Wifi,
  'wifi-off': WifiOff,
  boxes: Boxes, building: Building2, calendar: Calendar, check: Check, 'check-circle': CircleCheck,
  'chevron-down': ChevronDown, 'chevron-right': ChevronRight, 'circle-alert': CircleAlert, clock: Clock,
  coins: Coins, container: Container, dashboard: LayoutDashboard, download: Download, edit: Pencil,
  eye: Eye, factory: Factory, file: FileText, globe: Globe, handshake: Handshake, inbox: Inbox,
  info: Info, landmark: Landmark, lock: Lock, logout: LogOut, menu: Menu, more: Ellipsis,
  package: Package, palette: Palette, 'piggy-bank': PiggyBank, plus: Plus, receipt: Receipt,
  scale: Scale, search: Search, send: Send, settings: Settings, 'shield-check': ShieldCheck,
  sheet: FileSpreadsheet, trash: Trash2, 'trending-up': TrendingUp, truck: Truck, undo: RotateCcw,
  upload: Upload, users: Users, wallet: Wallet, x: X,
} as const;

export type IconName = keyof typeof ICONS;

type IconNode = [string, Record<string, string>];

@Component({
  selector: 'app-icon',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
         stroke-linejoin="round" [attr.width]="size()" [attr.height]="size()">
      @for (n of nodes(); track $index) {
        @switch (n[0]) {
          @case ('path') { <path [attr.d]="n[1]['d']" /> }
          @case ('circle') { <circle [attr.cx]="n[1]['cx']" [attr.cy]="n[1]['cy']" [attr.r]="n[1]['r']" /> }
          @case ('ellipse') { <ellipse [attr.cx]="n[1]['cx']" [attr.cy]="n[1]['cy']" [attr.rx]="n[1]['rx']" [attr.ry]="n[1]['ry']" /> }
          @case ('rect') {
            <rect [attr.x]="n[1]['x']" [attr.y]="n[1]['y']" [attr.width]="n[1]['width']"
                  [attr.height]="n[1]['height']" [attr.rx]="n[1]['rx']" [attr.ry]="n[1]['ry']" />
          }
          @case ('line') { <line [attr.x1]="n[1]['x1']" [attr.y1]="n[1]['y1']" [attr.x2]="n[1]['x2']" [attr.y2]="n[1]['y2']" /> }
          @case ('polyline') { <polyline [attr.points]="n[1]['points']" /> }
          @case ('polygon') { <polygon [attr.points]="n[1]['points']" /> }
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  protected nodes = computed(() => ICONS[this.name()] as unknown as IconNode[]);
}
