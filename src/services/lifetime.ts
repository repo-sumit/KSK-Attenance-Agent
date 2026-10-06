/** What a container releases when it is disposed (D-158): run once, in order; one that throws does not stop the rest. */
export class Lifetime {
  private disposed = false;
  constructor(private readonly releases: Array<() => void>) {}

  add(release: () => void): void {
    if (this.disposed) run(release);
    else this.releases.push(release);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases.splice(0)) run(release);
  }
}

function run(release: () => void): void {
  try {
    release();
  } catch {
    /* a release that fails leaves nothing else running: the others still go */
  }
}
