import type { ModuleContext, ModuleResult } from '../types'
import { BaseModule, ModuleUtils } from './index'

// Bun module
export class BunModule extends BaseModule {
  name = 'bun'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['bun.lockb', 'bun.lock', 'bunfig.toml'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('bun --version')
    const symbol = '🥟'
    const content = version ? `${symbol} v${version}` : symbol

    return this.formatResult(content, { color: '#f472b6' })
  }
}

// Deno module
export class DenoModule extends BaseModule {
  name = 'deno'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['deno.json', 'deno.jsonc', 'deno.lock', 'mod.ts', 'mod.js', 'deps.ts', 'deps.js'])
      || ModuleUtils.hasExtensions(context, ['.ts', '.js'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const output = await ModuleUtils.getCommandOutput('deno -V')
    const version = output ? ModuleUtils.parseVersion(output) : null
    const symbol = '🦕'
    const content = version ? `${symbol} v${version}` : symbol

    return this.formatResult(content, { color: '#22c55e' })
  }
}

// Node.js/JavaScript module
export class NodeModule extends BaseModule {
  name = 'nodejs'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['package.json', 'package-lock.json', 'yarn.lock', '.nvmrc', '.node-version'])
      || ModuleUtils.hasExtensions(context, ['.js', '.mjs', '.cjs', '.ts'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('node --version')
    const symbol = '⬢'
    const content = version ? `${symbol} ${version}` : symbol

    return this.formatResult(content, { color: '#22c55e' })
  }
}

// Python module
export class PythonModule extends BaseModule {
  name = 'python'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['requirements.txt', 'pyproject.toml', 'Pipfile', 'tox.ini', 'setup.py', '__init__.py'])
      || ModuleUtils.hasExtensions(context, ['.py', '.ipynb'])
      || ModuleUtils.hasDirectories(context, ['.venv', 'venv'])
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('python --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🐍'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    // Check for virtual environment
    const venv = context.environment.VIRTUAL_ENV || context.environment.CONDA_DEFAULT_ENV
    const venvName = venv ? ` (${venv.split('/').pop()})` : ''

    return this.formatResult(content + venvName, { color: '#3776ab' })
  }
}

// Go module
export class GoModule extends BaseModule {
  name = 'golang'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['go.mod', 'go.sum', 'glide.yaml', 'Gopkg.yml', 'Gopkg.lock', '.go-version'])
      || ModuleUtils.hasExtensions(context, ['.go'])
      || ModuleUtils.hasDirectories(context, ['Godeps'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('go version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🐹'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#00add8' })
  }
}

// Java module
export class JavaModule extends BaseModule {
  name = 'java'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'build.sbt', '.java-version'])
      || ModuleUtils.hasExtensions(context, ['.java', '.class', '.jar'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('java -version 2>&1')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '☕'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#ed8b00' })
  }
}

// Kotlin module
export class KotlinModule extends BaseModule {
  name = 'kotlin'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasExtensions(context, ['.kt', '.kts'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('kotlin -version 2>&1')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🅺'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#7f52ff' })
  }
}

// PHP module
export class PhpModule extends BaseModule {
  name = 'php'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['composer.json', 'composer.lock', '.php-version'])
      || ModuleUtils.hasExtensions(context, ['.php'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('php --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🐘'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#777bb4' })
  }
}

// Ruby module
export class RubyModule extends BaseModule {
  name = 'ruby'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['Gemfile', 'Gemfile.lock', '.ruby-version', '.rvmrc'])
      || ModuleUtils.hasExtensions(context, ['.rb'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('ruby --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '💎'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#cc342d' })
  }
}

// Swift module
export class SwiftModule extends BaseModule {
  name = 'swift'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['Package.swift'])
      || ModuleUtils.hasExtensions(context, ['.swift'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('swift --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🐦'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#fa7343' })
  }
}

// Zig module
export class ZigModule extends BaseModule {
  name = 'zig'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['build.zig'])
      || ModuleUtils.hasExtensions(context, ['.zig'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('zig version')
    const symbol = '⚡'
    const content = version ? `${symbol} v${version}` : symbol

    return this.formatResult(content, { color: '#f7a41d' })
  }
}

// Lua module
export class LuaModule extends BaseModule {
  name = 'lua'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['.lua-version'])
      || ModuleUtils.hasExtensions(context, ['.lua'])
      || ModuleUtils.hasDirectories(context, ['lua'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('lua -v')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🌙'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#000080' })
  }
}

// Perl module
export class PerlModule extends BaseModule {
  name = 'perl'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['Makefile.PL', 'Build.PL', 'cpanfile', 'cpanfile.snapshot', 'META.json', 'META.yml'])
      || ModuleUtils.hasExtensions(context, ['.pl', '.pm', '.pod'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('perl --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🐪'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#39457e' })
  }
}

// R module
export class RModule extends BaseModule {
  name = 'rlang'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['DESCRIPTION', '.Rprofile'])
      || ModuleUtils.hasExtensions(context, ['.R', '.Rd', '.Rmd', '.Rsx'])
      || ModuleUtils.hasDirectories(context, ['.Rproj.user'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('R --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '📊'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#198ce7' })
  }
}

// .NET module
export class DotNetModule extends BaseModule {
  name = 'dotnet'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['global.json', 'project.json', 'Directory.Build.props', 'Directory.Build.targets', 'Packages.props'])
      || ModuleUtils.hasExtensions(context, ['.csproj', '.fsproj', '.xproj', '.sln'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('dotnet --version')
    const symbol = '.NET'
    const content = version ? `${symbol} v${version}` : symbol

    return this.formatResult(content, { color: '#512bd4' })
  }
}

// Erlang module
export class ErlangModule extends BaseModule {
  name = 'erlang'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['rebar.config', 'erlang.mk'])
      || ModuleUtils.hasExtensions(context, ['.erl', '.hrl'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('erl -noshell -eval "io:format(\\"~s\\", [erlang:system_info(otp_release)]), halt()."')
    const symbol = 'E'
    const content = version ? `${symbol} v${version}` : symbol

    return this.formatResult(content, { color: '#a90533' })
  }
}

// C module
export class CModule extends BaseModule {
  name = 'c'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasExtensions(context, ['.c', '.h'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('gcc --version')
      || await ModuleUtils.getCommandOutput('clang --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = 'C'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#555555' })
  }
}

// C++ module
export class CppModule extends BaseModule {
  name = 'cpp'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasExtensions(context, ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.hh'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('g++ --version')
      || await ModuleUtils.getCommandOutput('clang++ --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = 'C++'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#f34b7d' })
  }
}

// CMake module
export class CMakeModule extends BaseModule {
  name = 'cmake'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['CMakeLists.txt', 'CMakeCache.txt'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('cmake --version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '△'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#064f8c' })
  }
}

// Terraform module
export class TerraformModule extends BaseModule {
  name = 'terraform'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['.terraform-version'])
      || ModuleUtils.hasExtensions(context, ['.tf', '.hcl'])
      || ModuleUtils.hasDirectories(context, ['.terraform'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('terraform version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '💠'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#623ce4' })
  }
}

// Pulumi module
export class PulumiModule extends BaseModule {
  name = 'pulumi'
  enabled = true

  detect(context: ModuleContext): boolean {
    return ModuleUtils.hasFiles(context, ['Pulumi.yaml', 'Pulumi.yml'])
  }

  async render(_context: ModuleContext): Promise<ModuleResult | null> {
    const version = await ModuleUtils.getCommandOutput('pulumi version')
    const parsedVersion = version ? ModuleUtils.parseVersion(version) : null
    const symbol = '🧊'
    const content = parsedVersion ? `${symbol} v${parsedVersion}` : symbol

    return this.formatResult(content, { color: '#8a3391' })
  }
}
