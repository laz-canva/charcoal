import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import tmp from 'tmp';
import {
  initContext,
  initContextLite,
  TContext,
} from '../../../src/lib/context';
import { composeGit } from '../../../src/lib/git/git';
import { cuteString } from '../../../src/lib/utils/cute_string';
import { GitRepo } from '../../../src/lib/utils/git_repo';

export abstract class AbstractScene {
  tmpDir: tmp.DirResult;
  originTmpDir: tmp.DirResult | undefined;
  repo: GitRepo;
  dir: string;
  originDir: string | undefined;
  oldDir: string;

  constructor() {
    this.tmpDir = tmp.dirSync();
    this.dir = this.tmpDir.name;
    this.repo = new GitRepo(this.dir);
    this.oldDir = process.cwd();
  }

  abstract toString(): string;

  public setup(): void {
    this.tmpDir = tmp.dirSync();
    this.dir = this.tmpDir.name;
    this.repo = new GitRepo(this.dir);
    fs.writeFileSync(
      `${this.dir}/.git/.graphite_repo_config`,
      cuteString({ trunk: 'main', isGithubIntegrationEnabled: false })
    );
    const userConfigPath = `${this.dir}/.git/.graphite_user_config`;
    fs.writeFileSync(userConfigPath, cuteString({ tips: false }));
    process.env.GRAPHITE_USER_CONFIG_PATH = userConfigPath;
    process.env.GRAPHITE_PROFILE = '';
    this.oldDir = process.cwd();
    process.chdir(this.dir);

    // Set up a bare repo as origin so sync commands can pull
    this.originTmpDir = tmp.dirSync();
    this.originDir = this.originTmpDir.name;
    spawnSync('git', ['init', '--bare', this.originDir]);
    spawnSync('git', ['remote', 'add', 'origin', this.originDir], {
      cwd: this.dir,
    });
  }

  // Push main to origin - call after initial commits are made
  public pushMainToOrigin(): void {
    if (this.originDir) {
      spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: this.dir });
    }
  }

  public cleanup(): void {
    process.chdir(this.oldDir);
    if (!process.env.DEBUG) {
      fs.removeSync(this.dir);
      if (this.originDir) {
        fs.removeSync(this.originDir);
      }
    }
  }

  public getContext(interactive = false): TContext {
    const oldDir = process.cwd();
    process.chdir(this.tmpDir.name);
    const context = initContext(
      initContextLite({
        interactive,
        quiet: !process.env.DEBUG,
        debug: !!process.env.DEBUG,
      }),
      composeGit(),
      {
        verify: false,
      }
    );
    process.chdir(oldDir);
    return context;
  }
}
