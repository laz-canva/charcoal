import { expect } from 'chai';
import { BasicScene } from '../../lib/scenes/basic_scene';
import { configureTest } from '../../lib/utils/configure_test';
import {
  replaceUnsupportedCharacters,
  newBranchName,
} from '../../../src/lib/utils/branch_name';

for (const scene of [new BasicScene()]) {
  describe(`(${scene}): branch naming config options`, function () {
    configureTest(this, scene);

    describe('branchLowercase', () => {
      it('lowercases branch names by default (branchLowercase: true)', () => {
        const context = scene.getContext();
        const result = replaceUnsupportedCharacters('MyBranchName', context);
        expect(result).to.equal('mybranchname');
      });

      it('preserves case when branchLowercase is false', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => (data.branchLowercase = false));
        const result = replaceUnsupportedCharacters('MyBranchName', context);
        expect(result).to.equal('MyBranchName');
      });

      it('lowercases branch names when branchLowercase is explicitly true', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => (data.branchLowercase = true));
        const result = replaceUnsupportedCharacters('MyBranchName', context);
        expect(result).to.equal('mybranchname');
      });
    });

    describe('branchReplaceSlashes', () => {
      it('replaces slashes by default (branchReplaceSlashes: true)', () => {
        const context = scene.getContext();
        const result = replaceUnsupportedCharacters(
          'feature/my-branch',
          context
        );
        expect(result).to.equal('feature_my-branch');
      });

      it('preserves slashes when branchReplaceSlashes is false', () => {
        const context = scene.getContext();
        context.userConfig.update(
          (data) => (data.branchReplaceSlashes = false)
        );
        const result = replaceUnsupportedCharacters(
          'feature/my-branch',
          context
        );
        expect(result).to.equal('feature/my-branch');
      });

      it('replaces slashes when branchReplaceSlashes is explicitly true', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => (data.branchReplaceSlashes = true));
        const result = replaceUnsupportedCharacters(
          'feature/my-branch',
          context
        );
        expect(result).to.equal('feature_my-branch');
      });

      it('preserves nested slashes when branchReplaceSlashes is false', () => {
        const context = scene.getContext();
        context.userConfig.update(
          (data) => (data.branchReplaceSlashes = false)
        );
        const result = replaceUnsupportedCharacters(
          'team/feature/sub-task',
          context
        );
        expect(result).to.equal('team/feature/sub-task');
      });
    });

    describe('branchPrefixExplicit', () => {
      it('applies prefix to explicit branch names by default (branchPrefixExplicit: true)', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => (data.branchPrefix = 'user/'));
        const result = newBranchName('my-branch', undefined, context);
        expect(result).to.equal('user/my-branch');
      });

      it('does not apply prefix to explicit branch names when branchPrefixExplicit is false', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = false;
        });
        const result = newBranchName('my-branch', undefined, context);
        expect(result).to.equal('my-branch');
      });

      it('applies prefix to explicit branch names when branchPrefixExplicit is explicitly true', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = true;
        });
        const result = newBranchName('my-branch', undefined, context);
        expect(result).to.equal('user/my-branch');
      });

      it('always applies prefix to auto-generated branch names regardless of branchPrefixExplicit', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = false;
          data.branchDate = false;
        });
        const result = newBranchName(undefined, 'my commit message', context);
        expect(result?.startsWith('user/')).to.be.true;
        expect(result).to.include('my_commit_message');
      });

      it('does not double-apply prefix if branch already has it', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user-';
          data.branchPrefixExplicit = true;
        });
        const result = newBranchName('user-my-branch', undefined, context);
        expect(result).to.equal('user-my-branch');
      });

      it('does not double-apply prefix with slashes when preserved', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = true;
          data.branchReplaceSlashes = false;
        });
        const result = newBranchName('user/my-branch', undefined, context);
        expect(result).to.equal('user/my-branch');
      });

      it('does not double-apply prefix when the explicit name is typed with the prefix and slashes are replaced (default)', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = true;
        });
        // branchReplaceSlashes defaults to true, so 'user/my-branch' sanitizes
        // to 'user_my-branch' before the prefix check runs.
        const result = newBranchName('user/my-branch', undefined, context);
        expect(result).to.equal('user_my-branch');
      });

      it('does not double-apply prefix when the explicit name already has it with a different separator', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'user/';
          data.branchPrefixExplicit = true;
        });
        const result = newBranchName('user_my-branch', undefined, context);
        expect(result).to.equal('user_my-branch');
      });
    });

    describe('combined config options', () => {
      it('respects both branchLowercase and branchReplaceSlashes', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchLowercase = false;
          data.branchReplaceSlashes = false;
        });
        const result = replaceUnsupportedCharacters(
          'Feature/MyBranch',
          context
        );
        expect(result).to.equal('Feature/MyBranch');
      });

      it('applies all config options together', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchPrefix = 'dev/';
          data.branchPrefixExplicit = true;
          data.branchLowercase = false;
          data.branchReplaceSlashes = false;
        });
        const result = newBranchName('Feature/MyTask', undefined, context);
        expect(result).to.equal('dev/Feature/MyTask');
      });

      it('applies lowercase but preserves slashes', () => {
        const context = scene.getContext();
        context.userConfig.update((data) => {
          data.branchLowercase = true;
          data.branchReplaceSlashes = false;
        });
        const result = replaceUnsupportedCharacters(
          'Feature/MyBranch',
          context
        );
        expect(result).to.equal('feature/mybranch');
      });
    });
  });
}
