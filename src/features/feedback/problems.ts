/** Problem screens as data (the prototype's `errDef`): tone, icon, title, body. */
import type { IconName } from '@/components/ui/icons/Icon';
import type { Tone } from '@/components/ui/Badge';
import type { MessageKey } from '@/i18n';

export type ProblemKind =
  | 'outside'
  | 'gps'
  | 'noFix'
  | 'locationDenied'
  | 'cameraDeniedEnrol'
  | 'cameraDeniedVerify'
  | 'cameraNotFound'
  | 'cameraBusy'
  | 'cameraFailed'
  | 'cameraUnsupported'
  | 'faceNotSeen'
  | 'faceDistance'
  | 'faceOffCentre'
  | 'faceNoTurn'
  | 'face'
  | 'faceLimit'
  | 'enrolFail'
  | 'light'
  | 'multi'
  | 'notOpen'
  | 'closed'
  | 'noPack'
  | 'noConnection'
  | 'noAccess'
  | 'selfFirst'
  | 'notFound';

export const PROBLEMS: Readonly<Record<ProblemKind, { tone: Tone; icon: IconName; title: MessageKey; body: MessageKey }>> = {
  outside: { tone: 'error', icon: 'map-pin', title: 'problem.outsideTitle', body: 'problem.outsideBody' },
  gps: { tone: 'warning', icon: 'navigation-off', title: 'problem.gpsTitle', body: 'problem.gpsBody' },
  noFix: { tone: 'warning', icon: 'map-pin', title: 'problem.noFixTitle', body: 'problem.noFixBody' },
  locationDenied: { tone: 'warning', icon: 'map-pin', title: 'problem.locationDeniedTitle', body: 'problem.locationDeniedBody' },
  cameraDeniedEnrol: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraDeniedTitle', body: 'problem.cameraDeniedBodyEnrol' },
  cameraDeniedVerify: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraDeniedTitle', body: 'problem.cameraDeniedBodyVerify' },
  cameraNotFound: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraNotFoundTitle', body: 'problem.cameraNotFoundBody' },
  cameraBusy: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraBusyTitle', body: 'problem.cameraBusyBody' },
  cameraFailed: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraFailedTitle', body: 'problem.cameraFailedBody' },
  cameraUnsupported: { tone: 'warning', icon: 'camera-off', title: 'problem.cameraUnsupportedTitle', body: 'problem.cameraUnsupportedBody' },
  faceNotSeen: { tone: 'warning', icon: 'scan-face', title: 'problem.faceNotSeenTitle', body: 'problem.faceNotSeenBody' },
  faceDistance: { tone: 'warning', icon: 'scan-face', title: 'problem.faceDistanceTitle', body: 'problem.faceDistanceBody' },
  faceOffCentre: { tone: 'warning', icon: 'scan-face', title: 'problem.faceOffCentreTitle', body: 'problem.faceOffCentreBody' },
  faceNoTurn: { tone: 'warning', icon: 'rotate-ccw', title: 'problem.faceNoTurnTitle', body: 'problem.faceNoTurnBody' },
  face: { tone: 'error', icon: 'scan-face', title: 'problem.faceTitle', body: 'problem.faceBody' },
  faceLimit: { tone: 'error', icon: 'scan-face', title: 'problem.faceLimitTitle', body: 'problem.faceLimitBody' },
  enrolFail: { tone: 'error', icon: 'camera', title: 'problem.enrolFailTitle', body: 'problem.enrolFailBody' },
  light: { tone: 'warning', icon: 'sun', title: 'problem.lightTitle', body: 'problem.lightBody' },
  multi: { tone: 'warning', icon: 'users', title: 'problem.multiTitle', body: 'problem.multiBody' },
  notOpen: { tone: 'info', icon: 'clock', title: 'problem.notOpenTitle', body: 'problem.notOpenBody' },
  closed: { tone: 'neutral', icon: 'lock', title: 'problem.closedTitle', body: 'problem.closedBody' },
  noPack: { tone: 'warning', icon: 'wifi-off', title: 'problem.noPackTitle', body: 'problem.noPackBody' },
  noConnection: { tone: 'warning', icon: 'wifi-off', title: 'problem.noConnectionTitle', body: 'problem.noConnectionBody' },
  noAccess: { tone: 'neutral', icon: 'lock', title: 'problem.noAccessTitle', body: 'problem.noAccessBody' },
  selfFirst: { tone: 'warning', icon: 'user-check', title: 'selfFirst.title', body: 'selfFirst.body' },
  notFound: { tone: 'neutral', icon: 'info', title: 'problem.notFoundTitle', body: 'problem.notFoundBody' },
};
