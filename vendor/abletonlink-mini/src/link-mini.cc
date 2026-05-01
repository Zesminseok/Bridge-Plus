// Minimal Ableton Link binding for BRIDGE+.
//
// Surface: enable / setBpm / getBpm / getBeat / getPhase / getNumPeers / setBeat.
// Intentionally omits ThreadSafeFunction-based event callbacks — BRIDGE+ polls
// these getters from a JS setInterval, sidestepping the abort() crash observed
// with the upstream node-abletonlink callback path (v0.2.0-beta.0).

#include <napi.h>
#include <ableton/Link.hpp>

namespace {

constexpr double kQuantum = 4.0;

class Link : public Napi::ObjectWrap<Link> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function ctor = DefineClass(env, "Link", {
      InstanceMethod("enable",      &Link::Enable),
      InstanceMethod("setBpm",      &Link::SetBpm),
      InstanceMethod("getBpm",      &Link::GetBpm),
      InstanceMethod("getBeat",     &Link::GetBeat),
      InstanceMethod("getPhase",    &Link::GetPhase),
      InstanceMethod("getNumPeers", &Link::GetNumPeers),
      InstanceMethod("setBeat",     &Link::SetBeat),
    });
    exports.Set("Link", ctor);
    return exports;
  }

  explicit Link(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<Link>(info),
        link_(info.Length() > 0 && info[0].IsNumber()
                  ? info[0].As<Napi::Number>().DoubleValue()
                  : 120.0) {}

 private:
  Napi::Value Enable(const Napi::CallbackInfo& info) {
    bool on = info.Length() > 0 ? info[0].ToBoolean().Value() : true;
    link_.enable(on);
    return info.Env().Undefined();
  }

  Napi::Value SetBpm(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    double bpm = info[0].As<Napi::Number>().DoubleValue();
    auto state = link_.captureAppSessionState();
    state.setTempo(bpm, link_.clock().micros());
    link_.commitAppSessionState(state);
    return info.Env().Undefined();
  }

  Napi::Value GetBpm(const Napi::CallbackInfo& info) {
    auto state = link_.captureAppSessionState();
    return Napi::Number::New(info.Env(), state.tempo());
  }

  Napi::Value GetBeat(const Napi::CallbackInfo& info) {
    auto state = link_.captureAppSessionState();
    double beat = state.beatAtTime(link_.clock().micros(), kQuantum);
    return Napi::Number::New(info.Env(), beat);
  }

  Napi::Value GetPhase(const Napi::CallbackInfo& info) {
    auto state = link_.captureAppSessionState();
    double phase = state.phaseAtTime(link_.clock().micros(), kQuantum);
    return Napi::Number::New(info.Env(), phase);
  }

  Napi::Value GetNumPeers(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(),
                             static_cast<double>(link_.numPeers()));
  }

  Napi::Value SetBeat(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    double beat = info[0].As<Napi::Number>().DoubleValue();
    auto state = link_.captureAppSessionState();
    state.requestBeatAtTime(beat, link_.clock().micros(), kQuantum);
    link_.commitAppSessionState(state);
    return info.Env().Undefined();
  }

  ableton::Link link_;
};

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return Link::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(abletonlink_mini, InitModule)
