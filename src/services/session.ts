/**
 * SessionService — builds the SessionContext once per session start: master
 * data snapshot, resolved configuration, access scope and journey (PRD §5.2).
 */
import { deriveJourney } from '@/config/journey';
import { resolveAccess } from '@/domain/access';
import { toLocalDate, type Clock } from '@/lib/time';
import type { MasterDataRepository } from '@/repositories/interfaces';
import type { AuthService } from './auth';
import type { ConfigurationService } from './configuration';
import type { SessionContext } from './context';
import type { FaceMatchService } from './face';

export class SessionService {
  constructor(
    private readonly auth: AuthService,
    private readonly masterData: MasterDataRepository,
    private readonly configuration: ConfigurationService,
    private readonly face: FaceMatchService,
    private readonly clock: Clock,
    /** The real time of day for greetings (D-151); the app clock when none is given. */
    private readonly wallClock: Clock = clock,
  ) {}

  async load(): Promise<SessionContext | undefined> {
    const stored = await this.auth.currentSession();
    if (!stored) return undefined;
    const data = await this.masterData.getInstituteData(stored.instituteId);
    const institute = data.institutes[0];
    const user = data.staff.find((s) => s.id === stored.staffId);
    if (!institute || !user) {
      await this.auth.signOut();
      return undefined;
    }
    const config = this.configuration.resolveFor(institute, user.id);
    const access = resolveAccess(user, config, data, toLocalDate(this.clock.now()));
    const enrolled = await this.face.isEnrolled(user.id);
    const journey = deriveJourney(config, user, access, enrolled);
    return { user, institute, config, access, journey, data, clock: this.clock, wallClock: this.wallClock };
  }
}
