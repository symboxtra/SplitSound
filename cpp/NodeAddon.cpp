#include <nan.h>

Nan::Callback *callback = nullptr;
float arr[15] = {1,2,3,4,5,6,7,8,9,1,2,3,4,5,6};

/**
 * Create a standard C function that can be passed into HulaLoop.
 *
 * This will eventually be a class that implements ICallback.
 */
void callCallback(float *data, uint32_t length)
{
    // Create a local handle since this won't be called by node
    // This might not be needed since v8::Array::New(isolate) switched to Nan
    v8::Isolate *isolate = v8::Isolate::GetCurrent();
    v8::HandleScope handleScope(isolate);

    // Copy the data to something understandable by JS
    v8::Local<v8::Array> jsData = Nan::New<v8::Array>();
    for (uint32_t i = 0; i < length; i++)
    {
        Nan::Set(jsData, i, Nan::New<v8::Number>(data[i]));
    }

    if (callback != nullptr)
    {
        v8::Local<v8::Value> argv[2] = { jsData, Nan::New<v8::Number>(length) };
        callback->Call(2, argv);
    }
}

/**
 * Set the callback that HulaLoop will use to deliver audio.
 *
 * Audio is delivered as an array of TODO: type samples.
 *
 * This will overwrite an existing callback. Only 1 is allowed
 * currently.
 */
void setAudioCallback(const Nan::FunctionCallbackInfo<v8::Value> &args)
{
    if (callback != nullptr)
    {
        // TODO: deregister callback
        delete callback;
        callback = nullptr;
    }

    v8::Local<v8::Function> func = args[0].As<v8::Function>();
    callback = new Nan::Callback(func);

    for (int i = 0; i < 15; i++)
    {
        // Test this for now
        callCallback((float *)&arr, i);
    }
}

void Init(v8::Local<v8::Object> exports, v8::Local<v8::Object> module)
{
    Nan::SetMethod(module, "exports", setAudioCallback);
}

NODE_MODULE(addon, Init)