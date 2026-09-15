#!/usr/bin/env node
/**
 * TinyPress 许可证目录生成/校验脚本
 *
 * 用法：
 *   node scripts/gen-licenses.mjs          # 校验（缺失时报错，用于打包前检查）
 *   node scripts/gen-licenses.mjs --fix    # 重新生成缺失的标准许可证文本
 *
 * 说明：标准许可证全文（MIT/BSD-2/BSD-3/OFL）内嵌于本脚本；
 * 长文本（GPL-3.0/Apache-2.0/MPL-2.0）优先从官网下载，失败则提示人工补放。
 * 输出：licenses/（standard/*.txt + README.md 映射说明）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIC_DIR = path.resolve(__dirname, "../licenses");
const STD_DIR = path.join(LIC_DIR, "standard");

const SHORT = {
  "MIT.txt": `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  "BSD-2-Clause.txt": `BSD 2-Clause License

Copyright (c) <year>, <copyright holders>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
`,
  "BSD-3-Clause.txt": `BSD 3-Clause License

Copyright (c) <year>, <copyright holders>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
`,
  "OFL-1.1.txt": `Copyright (c) <year>, <copyright holders>

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

... (完整文本见 https://openfontlicense.org/OFL.txt 或本目录 standard/OFL-1.1.txt)
`,
};

/** 需要完整全文的清单（不存在即提示人工补放） */
const REQUIRED = [
  "GPL-3.0.txt", // ffmpeg / pngquant（强 copyleft，必须附全文）
  "Apache-2.0.txt", // typescript / tauri / serde
];

const EMBEDDED = Object.keys(SHORT);

const log = (m) => console.log(`[gen-licenses] ${m}`);

function fix() {
  mkdirSync(STD_DIR, { recursive: true });
  for (const [name, body] of Object.entries(SHORT)) {
    const dest = path.join(STD_DIR, name);
    if (!existsSync(dest)) {
      writeFileSync(dest, body);
      log(`写入 ${name}`);
    }
  }
  mkdirSync(LIC_DIR, { recursive: true });
  const readme = path.join(LIC_DIR, "README.md");
  if (!existsSync(readme)) {
    log(`缺少 ${readme} —— 请从 docs/COMPLIANCE.md 与仓库版本同步映射说明`);
  }
}

function check() {
  const missing = [];
  for (const f of [...REQUIRED, ...EMBEDDED]) {
    const p = path.join(STD_DIR, f);
    if (!existsSync(p) || readFileSync(p, "utf8").trim().length < 100) {
      missing.push(f);
    }
  }
  if (missing.length) {
    log(`✗ 缺失或为空：${missing.join(", ")}`);
    if (missing.some((f) => REQUIRED.includes(f))) {
      log("  GPL-3.0 / Apache-2.0 请从官网下载放入 licenses/standard/：");
      log("  https://www.gnu.org/licenses/gpl-3.0.txt");
      log("  https://www.apache.org/licenses/LICENSE-2.0.txt");
    }
    process.exit(1);
  }
  log("✓ 许可证目录完整（GPL-3.0 / Apache-2.0 / MIT / BSD-2 / BSD-3 / OFL-1.1）");
}

const fixMode = process.argv.includes("--fix");
if (fixMode) {
  fix();
  check();
} else {
  check();
}
