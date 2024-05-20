const SourceChecker = require("../SourceChecker")
const jsmd5 = require("js-md5")

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

class ItakuPostsSourceChecker extends SourceChecker {
  constructor() {
    super(true, false)

    this.SUPPORTED = [/.*:\/\/itaku\.ee\/posts\/(\d+).*/]
  }

  supportsSource(source) {
    for (let supported of this.SUPPORTED) {
      if (supported.test(source)) return true
    }

    return false
  }

  async _internalProcessPost(post, source) {
    let page
    try {
      page = await this.browser.newPage()
      await page.goto(source)

      let a = await this.waitForSelectorOrNull(page, "a[href^='https://itaku.ee/api']", 1500)
      if (!a) {
        let reveal = await this.waitForSelectorOrNull(page, ".gallery-item-container", 1500)
        if (reveal) {
          await reveal.evaluate(b => b.click())
          a = await this.waitForSelectorOrNull(page, "a[href^='https://itaku.ee/api']", 1500)
          if (!a) {
            let confirm = await this.waitForSelectorOrNull(page, ".mat-focus-indicator.mat-flat-button.mat-button-base.mat-warn", 1500)
            if (confirm) {
              await confirm.evaluate(b => b.click())
              a = await this.waitForSelectorOrNull(page, "a[href^='https://itaku.ee/api']", 1500)
              if (!a) {
                return {
                  error: true,
                  unknown: true,
                  md5Match: false,
                  dimensionMatch: false,
                  fileTypeMatch: false
                }
              }
            } else {
              return {
                error: true,
                unknown: true,
                md5Match: false,
                dimensionMatch: false,
                fileTypeMatch: false
              }
            }
          }
        } else {
          return {
            error: true,
            unknown: true,
            md5Match: false,
            dimensionMatch: false,
            fileTypeMatch: false
          }
        }
      }

      let href = await a.evaluate(ele => ele.href)

      if (!href) {
        return {
          error: true,
          unknown: true,
          md5Match: false,
          dimensionMatch: false,
          fileTypeMatch: false
        }
      }

      let res = await fetch(href)
      let blob = await res.blob()
      let arrayBuffer = await blob.arrayBuffer()

      let md5 = jsmd5(arrayBuffer)

      let dimensions = await super.getDimensions(blob.type, arrayBuffer)

      let realFileType = await this.getRealFileType(arrayBuffer)

      if (!realFileType) {
        return {
          unsupported: true,
          md5Match: false,
          dimensionMatch: false,
          fileTypeMatch: false
        }
      }

      return {
        md5Match: md5 == post.md5,
        dimensionMatch: dimensions.width == post.width && dimensions.height == post.height,
        fileTypeMatch: realFileType == post.fileType,
        fileType: realFileType,
        dimensions
      }
    } catch (e) {
      console.error(post._id, source)
      console.error(e)
    } finally {
      await page.close()
    }

    return {
      unknown: true,
      error: true,
      md5Match: false,
      dimensionMatch: false,
      fileTypeMatch: false
    }
  }

  async processPost(post, current) {
    while (!this.puppetReady) {
      await wait(500)
    }

    let data = {}
    for (let source of post.sources) {
      if (current?.data?.[source]) continue
      if (this.supportsSource(source)) {
        data[source] = await this._internalProcessPost(post, source)
      }
    }

    return data
  }
}

module.exports = ItakuPostsSourceChecker