package ir.pptsaz.app

import android.app.Application

class PptSazApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
        Notifier.ensureChannel(this)
        Push.init(this)
    }
}
