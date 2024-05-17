const SourceChecker = require("../SourceChecker")
const jsmd5 = require("js-md5")
const puppeteer = require("puppeteer")
const parseSrcset = require("parse-srcset")

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

class SoFurrySourchChecker extends SourceChecker {
  constructor() {
    super()

    this.SUPPORTED = [new RegExp(".*:\/\/pawoo\.net\/@.*\/(\d*).*")]
    this.ready = false

    puppeteer.launch({ headless: true, args: ["--no-sandbox"] }).then((browser) => {
      this.browser = browser
      this.ready = true
    })
  }

  supportsSource(source) {
    for (let supported of this.SUPPORTED) {
      if (supported.test(source)) return true
    }

    return false
  }

  async _internalProcessPost(post, source) {
    try {
      const page = await this.browser.newPage()
      await page.goto(source)

      let main = await page.waitForSelector(".media-gallery", { timeout: 50000 })
      if (!main) return
      let sensitive = await main.waitForSelector(".spoiler-button__overlay", { timeout: 1000 })
      if (sensitive) {
        await sensitive.evaluate(b => b.click())
      }

      let allImages = (await main.$$(".media-gallery__item-thumbnail > img"))

      for (let i = 0; i < allImages.length; i++) {
        let srcset = await allImages[i].evaluate(e => e.getAttribute("srcset"))
        if (!srcset) {
          allImages[i] = [await allImages[i].evaluate(e => e.getAttribute("src"))]
          continue
        }
        let parsed = parseSrcset(srcset)
        allImages[i] = parsed.map(p => p.url)
      }

      allImages = allImages.flat()

      await page.close()

      let matchData = []

      for (let src of allImages) {
        let res = await fetch(src)
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

        let d = {
          md5Match: md5 == post.md5,
          dimensionMatch: dimensions.width == post.width && dimensions.height == post.height,
          fileTypeMatch: realFileType == post.fileType,
          fileType: realFileType,
          dimensions
        }

        d.score = (d.md5Match * 1000) + (d.dimensionMatch * 500) + d.fileTypeMatch

        matchData.push(d)
      }

      if (matchData.length > 0) {
        matchData.sort((a, b) => b.score - a.score)

        return matchData[0]
      }
    } catch (e) {
      console.error(post.id, source)
      console.error(e)
    }

    return {
      md5Match: false,
      dimensionMatch: false,
      fileTypeMatch: false
    }
  }

  async processPost(post, current) {
    while (!this.ready) {
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

module.exports = SoFurrySourchChecker