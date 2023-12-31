// Dependencies
const { Client, ConnectionOptions, UndiciConnection } = require("@elastic/elasticsearch")
const { kEmitter } = require("@elastic/transport/lib/symbols")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const Utilities = require("../structures/Utilities")

const config = require("../config.json")

module.exports = async () => {
  console.log("Starting")
  try {
    const elasticSearchClient = new Client({
      node: config.elasticSearchUrl,
      Connection: class extends UndiciConnection {
        constructor(properties) {
          super(properties)
          this[kEmitter].setMaxListeners(0)
        }
      }
    })

    const utils = new Utilities(elasticSearchClient)

    const app = express()

    app.set("trust proxy", 1)

    app.use(bodyParser.json())
    app.use(cors())

    // routers
    app.use("/", require("./routes/main.js")(utils))

    return app
  } catch (e) {
    console.error(e)
  }
}

process.on("unhandledRejection", (r, p) => {
  console.error(r)
  console.error(p)
})